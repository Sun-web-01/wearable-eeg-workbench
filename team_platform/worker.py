from __future__ import annotations

import json
import shutil
import threading
import traceback
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict
from pathlib import Path
from typing import Any

from wearable_eeg.io import load_any
from wearable_eeg.labels import attach_sleep_labels, read_mne_annotations
from wearable_eeg.pipeline import PipelineConfig, process_dataframe
from wearable_eeg.report import write_features_csv, write_html, write_json
from wearable_eeg.synthetic import generate_demo

from .db import Database, utc_now


class JobRunner:
    def __init__(self, database: Database, workers: int = 2):
        self.database = database
        self.executor = ThreadPoolExecutor(max_workers=workers, thread_name_prefix="eeg-job")
        self._queued: set[str] = set()
        self._lock = threading.Lock()

    def resume_pending(self) -> None:
        for job_id in self.database.jobs_to_resume():
            self.submit(job_id)

    def submit(self, job_id: str) -> None:
        with self._lock:
            if job_id in self._queued:
                return
            self._queued.add(job_id)
        self.executor.submit(self._run_guarded, job_id)

    def _run_guarded(self, job_id: str) -> None:
        try:
            self._run(job_id)
        except Exception as exc:
            self.database.update_job(
                job_id,
                status="failed",
                error=str(exc),
                finished_at=utc_now(),
            )
            self.database.add_event(job_id, f"处理失败：{exc}")
            traceback.print_exc()
        finally:
            with self._lock:
                self._queued.discard(job_id)

    def _run(self, job_id: str) -> None:
        job = self.database.get_job(job_id)
        if not job:
            raise ValueError("任务不存在。")
        if job["status"] == "completed":
            return

        self.database.update_job(job_id, status="processing", started_at=utc_now(), error=None)
        self.database.add_event(job_id, "开始处理数据")
        config_data = json.loads(job["config_json"])
        config = PipelineConfig(**config_data)

        if job["mode"] == "demo":
            frame = generate_demo(seconds=90)
            metadata: dict[str, Any] = {"source_format": "synthetic", "purpose": "team_demo"}
            source_name = "team_demo.csv"
        else:
            if not job["input_path"]:
                raise ValueError("任务缺少输入文件。")
            frame, metadata = load_any(job["input_path"])
            source_name = job["input_name"] or "uploaded"
            if job["annotations_path"]:
                intervals = read_mne_annotations(job["annotations_path"])
                frame = attach_sleep_labels(frame, intervals)
                metadata["label_source"] = Path(job["annotations_path"]).name
                metadata["label_intervals"] = len(intervals)

        self.database.add_event(job_id, "读取与预处理完成，开始质量评估")
        report, filtered = process_dataframe(
            frame,
            config=config,
            source_name=source_name,
            metadata=metadata,
        )
        if not job["output_dir"]:
            raise ValueError("任务缺少输出目录。")
        output_dir = Path(job["output_dir"])
        output_dir.mkdir(parents=True, exist_ok=True)
        write_json(report, output_dir / "report.json")
        write_html(report, output_dir / "report.html")
        write_features_csv(report, output_dir / "features.csv")
        filtered.to_csv(output_dir / "processed.csv", index=False)

        quality = report["quality"]["overall"]
        duration = report["overview"]["duration_s"]
        self.database.update_job(
            job_id,
            status="completed",
            quality_grade=quality["grade"],
            quality_score=quality["score"],
            duration_s=duration,
            finished_at=utc_now(),
            output_dir=str(output_dir),
        )
        self.database.add_event(
            job_id,
            f"处理完成：质量 {quality['grade']}，可用窗口 {report['epochs']['kept_windows']} 个",
        )

    def shutdown(self) -> None:
        self.executor.shutdown(wait=False, cancel_futures=False)


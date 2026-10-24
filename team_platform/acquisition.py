from __future__ import annotations

import hashlib
import json
import re
import shutil
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from .db import utc_now


PROFILES = {
    "synthetic": {
        "label": "BrainFlow 模拟设备",
        "board_attr": "SYNTHETIC_BOARD",
        "transport": "内置模拟",
        "address_field": None,
        "address_label": "无需地址",
        "description": "用于验证扫描、采集、文件命名和分析流程，不连接真实受试者。",
    },
    "muse2": {
        "label": "Muse 2",
        "board_attr": "MUSE_2_BOARD",
        "transport": "蓝牙",
        "address_field": "serial_number",
        "address_label": "蓝牙地址 / 设备序列号",
        "description": "消费级 4 通道 EEG；BrainFlow 当前配置主要提供 EEG。",
    },
    "muse_s": {
        "label": "Muse S",
        "board_attr": "MUSE_S_BOARD",
        "transport": "蓝牙",
        "address_field": "serial_number",
        "address_label": "蓝牙地址 / 设备序列号",
        "description": "消费级 4 通道 EEG；具体传感器能力以实际固件和 BrainFlow 为准。",
    },
    "cyton": {
        "label": "OpenBCI Cyton",
        "board_attr": "CYTON_BOARD",
        "transport": "USB 串口 / Dongle",
        "address_field": "serial_port",
        "address_label": "串口，例如 COM3",
        "description": "研究型 8 通道 EEG，支持加速度通道；需要 OpenBCI Dongle。",
    },
}

DEVICE_PATTERN = re.compile(
    r"(muse|openbci|cyton|ganglion|brainbit|notion|galea|unicorn|callibri|freeeeg|pieeg|emotiv)",
    re.IGNORECASE,
)


def _safe_slug(value: str, fallback: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9_-]+", "-", value.strip()).strip("-_")
    return (cleaned[:32] or fallback).lower()


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


class AcquisitionManager:
    def __init__(self, data_dir: Path):
        self.root = data_dir / "recordings"
        self.root.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._sessions: dict[str, dict[str, Any]] = {}
        self._stop_events: dict[str, threading.Event] = {}
        self._threads: dict[str, threading.Thread] = {}
        self._load_history()

    def _load_history(self) -> None:
        for manifest in sorted(self.root.glob("*/manifest.json"), key=lambda path: path.stat().st_mtime, reverse=True):
            try:
                session = json.loads(manifest.read_text(encoding="utf-8"))
                if session.get("id"):
                    self._sessions[str(session["id"])] = session
            except (OSError, ValueError):
                continue

    def _persist(self, session: dict[str, Any]) -> None:
        directory = self.root / session["id"]
        directory.mkdir(parents=True, exist_ok=True)
        (directory / "manifest.json").write_text(
            json.dumps(session, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    def _update(self, session_id: str, **fields: Any) -> dict[str, Any]:
        with self._lock:
            session = self._sessions[session_id]
            session.update(fields)
            self._persist(session)
            return dict(session)

    @staticmethod
    def profiles() -> list[dict[str, Any]]:
        try:
            from brainflow.board_shim import BoardIds, BoardShim
        except ImportError:
            return []
        result = []
        for profile_id, profile in PROFILES.items():
            board_id = getattr(BoardIds, profile["board_attr"])
            descriptor = BoardShim.get_board_descr(board_id)
            eeg_channels = descriptor.get("eeg_channels") or []
            accel_channels = descriptor.get("accel_channels") or []
            gyro_channels = descriptor.get("gyro_channels") or []
            eeg_names = descriptor.get("eeg_names")
            if isinstance(eeg_names, str):
                eeg_names = [item.strip() for item in eeg_names.split(",") if item.strip()]
            result.append({
                "id": profile_id,
                "label": profile["label"],
                "transport": profile["transport"],
                "address_field": profile["address_field"],
                "address_label": profile["address_label"],
                "description": profile["description"],
                "board_id": int(board_id),
                "sample_rate_hz": descriptor.get("sampling_rate"),
                "eeg_channel_count": len(eeg_channels),
                "imu_channel_count": len(accel_channels or []) + len(gyro_channels or []),
                "eeg_names": eeg_names or [],
            })
        return result

    @staticmethod
    async def scan(timeout_seconds: float = 4.0) -> dict[str, Any]:
        result: dict[str, Any] = {"bluetooth": [], "serial_ports": [], "warnings": []}
        try:
            from bleak import BleakScanner

            devices = await BleakScanner.discover(timeout=max(1.0, min(10.0, timeout_seconds)))
            seen: set[str] = set()
            for device in devices:
                address = str(getattr(device, "address", "") or "")
                name = str(getattr(device, "name", "") or "").strip()
                if not address or address in seen:
                    continue
                seen.add(address)
                supported = bool(DEVICE_PATTERN.search(name))
                if name and supported:
                    result["bluetooth"].append({
                        "name": name,
                        "address": address,
                        "supported": supported,
                        "kind": "bluetooth",
                    })
            result["bluetooth"].sort(key=lambda item: item["name"].lower())
        except Exception as exc:
            result["warnings"].append(f"蓝牙扫描失败：{str(exc)[:180]}")

        try:
            from serial.tools import list_ports

            for port in list_ports.comports():
                description = str(port.description or "")
                result["serial_ports"].append({
                    "name": port.device,
                    "description": description,
                    "address": port.device,
                    "supported": bool(DEVICE_PATTERN.search(description)),
                    "kind": "serial",
                })
        except Exception as exc:
            result["warnings"].append(f"串口扫描失败：{str(exc)[:180]}")
        return result

    def list_sessions(self, limit: int = 30) -> list[dict[str, Any]]:
        with self._lock:
            sessions = sorted(
                (dict(item) for item in self._sessions.values()),
                key=lambda item: str(item.get("created_at", "")),
                reverse=True,
            )
        return [self.public_session(item) for item in sessions[:limit]]

    def get_session(self, session_id: str) -> dict[str, Any] | None:
        with self._lock:
            session = self._sessions.get(session_id)
            return dict(session) if session else None

    def set_analysis_job(self, session_id: str, job_id: str) -> dict[str, Any]:
        return self._update(session_id, analysis_job_id=job_id)

    @staticmethod
    def public_session(session: dict[str, Any]) -> dict[str, Any]:
        fields = {
            "id", "status", "phase", "created_at", "started_at", "finished_at",
            "duration_sec", "captured_seconds", "sample_rate_hz", "eeg_channel_count",
            "imu_channel_count", "samples", "subject_id", "task", "profile_id",
            "profile_label", "transport", "address", "owner_name", "csv_name",
            "edf_name", "manifest_name", "csv_sha256", "error", "warnings",
            "analysis_job_id",
        }
        return {key: session.get(key) for key in fields}

    def start(
        self,
        *,
        profile_id: str,
        address: str,
        subject_id: str,
        task: str,
        duration_sec: int,
        user: dict[str, Any],
    ) -> dict[str, Any]:
        profile = PROFILES.get(profile_id)
        if not profile:
            raise ValueError("不支持的设备类型。")
        if profile_id != "synthetic" and not address.strip():
            raise ValueError(f"请输入{profile['address_label']}。")
        subject = _safe_slug(subject_id, "S01")
        task_slug = _safe_slug(task, "other")
        duration = max(3, min(3600, int(duration_sec)))
        with self._lock:
            active = [item for item in self._sessions.values() if item.get("status") in {"starting", "connecting", "recording", "stopping"}]
            if active:
                raise ValueError("已有设备正在采集，请先停止当前采集。")
            session_id = uuid.uuid4().hex[:12]
            now = datetime.now().astimezone()
            timestamp = now.strftime("%Y%m%d-%H%M%S")
            base = f"sub-{subject}_task-{task_slug}_acq-{_safe_slug(profile_id, 'device')}_{timestamp}"
            session = {
                "id": session_id,
                "status": "starting",
                "phase": "准备连接设备",
                "created_at": now.isoformat(timespec="seconds"),
                "started_at": None,
                "finished_at": None,
                "duration_sec": duration,
                "captured_seconds": 0,
                "sample_rate_hz": None,
                "eeg_channel_count": None,
                "imu_channel_count": None,
                "samples": 0,
                "subject_id": subject,
                "task": task_slug,
                "profile_id": profile_id,
                "profile_label": profile["label"],
                "transport": profile["transport"],
                "address": address.strip(),
                "owner_id": int(user["id"]),
                "owner_name": user["username"],
                "file_base": base,
                "csv_name": f"{base}.csv",
                "edf_name": f"{base}.edf",
                "manifest_name": f"{base}_metadata.json",
                "csv_sha256": None,
                "analysis_job_id": None,
                "warnings": [],
                "error": None,
            }
            self._sessions[session_id] = session
            self._persist(session)
            stop_event = threading.Event()
            self._stop_events[session_id] = stop_event
            thread = threading.Thread(
                target=self._run,
                args=(session_id, stop_event),
                name=f"eeg-acquisition-{session_id}",
                daemon=True,
            )
            self._threads[session_id] = thread
            thread.start()
        return self.public_session(session)

    def stop(self, session_id: str) -> dict[str, Any]:
        with self._lock:
            session = self._sessions.get(session_id)
            stop_event = self._stop_events.get(session_id)
        if not session:
            raise ValueError("采集任务不存在。")
        if session.get("status") not in {"starting", "connecting", "recording"}:
            return self.public_session(session)
        self._update(session_id, status="stopping", phase="正在结束采集并保存文件")
        if stop_event:
            stop_event.set()
        return self.public_session(self.get_session(session_id) or session)

    def _run(self, session_id: str, stop_event: threading.Event) -> None:
        board = None
        try:
            from brainflow.board_shim import BoardIds, BoardShim, BrainFlowInputParams

            session = self.get_session(session_id)
            if not session:
                return
            profile = PROFILES[session["profile_id"]]
            BoardShim.disable_board_logger()
            params = BrainFlowInputParams()
            address_field = profile.get("address_field")
            if address_field:
                setattr(params, address_field, session["address"])
            board_id = getattr(BoardIds, profile["board_attr"])
            descriptor = BoardShim.get_board_descr(board_id)
            self._update(
                session_id,
                status="connecting",
                phase=f"正在连接 {profile['label']}",
                sample_rate_hz=descriptor.get("sampling_rate"),
                eeg_channel_count=len(descriptor.get("eeg_channels") or []),
                imu_channel_count=len(descriptor.get("accel_channels") or []) + len(descriptor.get("gyro_channels") or []),
            )
            board = BoardShim(board_id, params)
            board.prepare_session()
            board.start_stream(45000, "")
            started = datetime.now().astimezone()
            monotonic_start = time.monotonic()
            self._update(
                session_id,
                status="recording",
                phase="采集进行中",
                started_at=started.isoformat(timespec="seconds"),
            )
            while not stop_event.is_set():
                elapsed = time.monotonic() - monotonic_start
                if elapsed >= session["duration_sec"]:
                    break
                try:
                    samples = int(board.get_board_data_count())
                except Exception:
                    samples = 0
                self._update(session_id, captured_seconds=round(elapsed, 1), samples=samples)
                stop_event.wait(0.5)

            self._update(session_id, status="stopping", phase="正在保存数据")
            data = board.get_board_data()
            board.stop_stream()
            board.release_session()
            board = None
            if data.size == 0:
                raise ValueError("设备没有返回任何采样数据。")
            self._write_recording(session_id, data, descriptor)
        except Exception as exc:
            if board is not None:
                try:
                    board.stop_stream()
                except Exception:
                    pass
                try:
                    board.release_session()
                except Exception:
                    pass
            self._update(
                session_id,
                status="failed",
                phase="采集失败",
                finished_at=utc_now(),
                error=str(exc)[:500],
            )

    def _write_recording(self, session_id: str, data: np.ndarray, descriptor: dict[str, Any]) -> None:
        session = self.get_session(session_id)
        if not session:
            return
        timestamp_channel = descriptor.get("timestamp_channel")
        if timestamp_channel is None:
            raise ValueError("设备没有提供时间戳通道。")
        timestamps = np.asarray(data[int(timestamp_channel)], dtype=float)
        time_s = timestamps - timestamps[0] if timestamps.size else timestamps
        frame = pd.DataFrame({"time_s": time_s})

        eeg_channels = list(descriptor.get("eeg_channels") or [])
        eeg_names = descriptor.get("eeg_names") or []
        if isinstance(eeg_names, str):
            eeg_names = [item.strip() for item in eeg_names.split(",") if item.strip()]
        for offset, channel in enumerate(eeg_channels):
            raw_name = eeg_names[offset] if offset < len(eeg_names) else f"CH{channel}"
            name = re.sub(r"[^A-Za-z0-9]+", "", raw_name) or str(channel)
            frame[f"eeg_{name}"] = np.asarray(data[int(channel)], dtype=float)

        accel_channels = list(descriptor.get("accel_channels") or [])
        for axis, channel in zip(("x", "y", "z"), accel_channels):
            frame[f"acc_{axis}"] = np.asarray(data[int(channel)], dtype=float)
        gyro_channels = list(descriptor.get("gyro_channels") or [])
        for axis, channel in zip(("x", "y", "z"), gyro_channels):
            frame[f"gyro_{axis}"] = np.asarray(data[int(channel)], dtype=float)
        marker_channel = descriptor.get("marker_channel")
        if marker_channel is not None:
            frame["marker"] = np.asarray(data[int(marker_channel)], dtype=float)

        directory = self.root / session_id
        directory.mkdir(parents=True, exist_ok=True)
        csv_path = directory / session["csv_name"]
        frame.to_csv(csv_path, index=False, float_format="%.6f")
        warnings: list[str] = []

        edf_path = directory / session["edf_name"]
        try:
            import mne

            eeg_columns = [column for column in frame.columns if column.startswith("eeg_")]
            if eeg_columns:
                sfreq = float(descriptor.get("sampling_rate") or 250.0)
                complete_seconds = max(1, int(len(frame) // sfreq))
                complete_samples = min(len(frame), int(complete_seconds * sfreq))
                info = mne.create_info(eeg_columns, sfreq=sfreq, ch_types="eeg", verbose=False)
                raw = mne.io.RawArray(
                    frame[eeg_columns].iloc[:complete_samples].to_numpy(dtype=float).T * 1e-6,
                    info,
                    verbose=False,
                )
                raw.set_meas_date(datetime.now(timezone.utc))
                mne.export.export_raw(edf_path, raw, fmt="edf", overwrite=True, verbose=False)
            else:
                warnings.append("设备没有 EEG 通道，未生成 EDF。")
        except Exception as exc:
            warnings.append(f"EDF 导出失败：{str(exc)[:180]}")
            edf_path = None

        manifest = {
            "schema_version": "1.0",
            "session": {
                "id": session_id,
                "subject_id": session["subject_id"],
                "task": session["task"],
                "created_at": session["created_at"],
                "started_at": session["started_at"],
                "finished_at": utc_now(),
            },
            "device": {
                "profile_id": session["profile_id"],
                "label": session["profile_label"],
                "transport": session["transport"],
                "address": session["address"],
                "board_id": descriptor.get("name"),
                "sample_rate_hz": descriptor.get("sampling_rate"),
                "eeg_channels": eeg_channels,
                "accel_channels": accel_channels,
                "gyro_channels": gyro_channels,
            },
            "format": {
                "csv": "统一时间序列，适合平台分析与跨软件读取",
                "edf": "EEG 常用生理信号格式；单位由 BrainFlow 微伏转换为伏",
                "naming": "sub-<受试者>_task-<状态>_acq-<设备>_<YYYYMMDD-HHMMSS>",
            },
            "files": {
                "csv": csv_path.name,
                "edf": edf_path.name if edf_path else None,
                "metadata": session["manifest_name"],
            },
            "warnings": warnings,
        }
        self._update(
            session_id,
            status="completed",
            phase="采集完成",
            finished_at=utc_now(),
            samples=int(len(frame)),
            captured_seconds=round(max(0.0, float(time_s[-1])), 1) if len(time_s) else 0,
            csv_sha256=_sha256(csv_path),
            edf_name=edf_path.name if edf_path else None,
            warnings=warnings,
            recording=manifest,
            error=None,
        )
        shutil.copyfile(
            directory / "manifest.json",
            directory / session["manifest_name"],
        )

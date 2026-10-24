from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd


STAGE_MAP = {
    "w": "wake",
    "wake": "wake",
    "1": "n1",
    "n1": "n1",
    "2": "n2",
    "n2": "n2",
    "3": "n3",
    "4": "n3",
    "n3": "n3",
    "r": "rem",
    "rem": "rem",
}


@dataclass(frozen=True)
class LabelInterval:
    onset_s: float
    duration_s: float
    label: str
    description: str


def canonical_sleep_stage(description: str) -> str:
    lower = description.strip().lower()
    if "sleep stage" in lower:
        lower = lower.split("sleep stage", 1)[1].strip()
    elif lower.startswith("stage "):
        lower = lower[6:].strip()
    return STAGE_MAP.get(lower, "unknown")


def labels_at_times(
    time_s: np.ndarray,
    intervals: list[LabelInterval],
) -> np.ndarray:
    labels = np.full(len(time_s), "unknown", dtype=object)
    for interval in intervals:
        start = interval.onset_s
        stop = interval.onset_s + interval.duration_s
        mask = (time_s >= start) & (time_s < stop)
        labels[mask] = interval.label
    return labels


def read_mne_annotations(path: str | Path) -> list[LabelInterval]:
    try:
        import mne
    except ImportError as exc:
        raise RuntimeError(
            "读取 Hypnogram 需要 MNE，请安装 requirements-research.txt。"
        ) from exc

    annotations = mne.read_annotations(path)
    intervals = []
    for onset, duration, description in zip(
        annotations.onset,
        annotations.duration,
        annotations.description,
    ):
        duration = float(duration) if np.isfinite(duration) and duration > 0 else 30.0
        intervals.append(
            LabelInterval(
                onset_s=float(onset),
                duration_s=duration,
                label=canonical_sleep_stage(str(description)),
                description=str(description),
            )
        )
    return intervals


def attach_sleep_labels(
    frame: pd.DataFrame,
    intervals: list[LabelInterval],
) -> pd.DataFrame:
    if "_time_s" not in frame.columns:
        raise ValueError("先准备数据时间轴，再附加睡眠标签。")
    result = frame.copy()
    result["sleep_stage"] = labels_at_times(
        result["_time_s"].to_numpy(dtype=float),
        intervals,
    )
    return result

from __future__ import annotations

import io
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd


TIME_CANDIDATES = (
    "time_s",
    "timestamp",
    "timestamp_s",
    "time",
    "lsl_time",
    "seconds",
)


class DataFormatError(ValueError):
    """Raised when a data source cannot be mapped to EEG/IMU columns."""


def _normalise(name: str) -> str:
    return name.strip().lower().replace("-", "_").replace(" ", "_")


def infer_column_roles(frame: pd.DataFrame) -> tuple[str | None, list[str], list[str]]:
    columns = list(frame.columns)
    normalised = {column: _normalise(str(column)) for column in columns}

    time_column = next(
        (
            column
            for candidate in TIME_CANDIDATES
            for column, value in normalised.items()
            if value == candidate
        ),
        None,
    )

    eeg_channels = [
        column
        for column, value in normalised.items()
        if column != time_column
        and (
            value.startswith("eeg")
            or value.endswith("_eeg")
            or value
            in {
                "fpz",
                "pz",
                "c3",
                "c4",
                "f3",
                "f4",
                "o1",
                "o2",
                "cz",
                "af3",
                "af4",
                "f7",
                "f8",
                "fc5",
                "fc6",
                "t7",
                "t8",
                "p7",
                "p8",
            }
        )
    ]

    imu_channels = [
        column
        for column, value in normalised.items()
        if column != time_column
        and any(token in value for token in ("acc", "gyro", "imu"))
    ]

    if not eeg_channels:
        raise DataFormatError(
            "未识别到 EEG 列。请使用 eeg_* 命名，或使用 Fpz/Pz/C3/C4 等标准通道名。"
        )
    return time_column, eeg_channels, imu_channels


def coerce_numeric(frame: pd.DataFrame) -> pd.DataFrame:
    result = frame.copy()
    for column in result.columns:
        converted = pd.to_numeric(result[column], errors="coerce")
        if converted.notna().any():
            result[column] = converted
    return result


def _time_seconds(
    frame: pd.DataFrame,
    time_column: str | None,
    sample_rate: float | None,
) -> np.ndarray:
    row_count = len(frame)
    if row_count < 2:
        raise DataFormatError("数据至少需要 2 行。")

    if time_column is not None and not frame[time_column].isna().all():
        time = frame[time_column].to_numpy(dtype=float)
        if time_column == "timestamp":
            finite = np.isfinite(time)
            if not finite.any():
                raise DataFormatError("timestamp 列没有有效数值。")
            time = time - np.nanmin(time)
            if np.nanmedian(time) > 1e6:
                time = time / 1_000.0
            elif np.nanmedian(time) > 1e3:
                raise DataFormatError(
                    "timestamp 看起来是秒级 Unix 时间，请改用 time_s 或提供采样率。"
                )
        return time

    if sample_rate is None or not np.isfinite(sample_rate) or sample_rate <= 0:
        raise DataFormatError("缺少时间列时必须提供正数 sample_rate。")
    return np.arange(row_count, dtype=float) / float(sample_rate)


def load_csv_text(text: str, sample_rate: float | None = None) -> pd.DataFrame:
    try:
        frame = pd.read_csv(io.StringIO(text))
    except Exception as exc:
        raise DataFormatError(f"CSV 读取失败：{exc}") from exc
    return prepare_frame(frame, sample_rate=sample_rate)


def load_csv(path: str | Path, sample_rate: float | None = None) -> pd.DataFrame:
    path = Path(path)
    try:
        frame = pd.read_csv(path)
    except Exception as exc:
        raise DataFormatError(f"CSV 读取失败：{exc}") from exc
    return prepare_frame(frame, sample_rate=sample_rate)


def prepare_frame(frame: pd.DataFrame, sample_rate: float | None = None) -> pd.DataFrame:
    if frame.empty:
        raise DataFormatError("数据为空。")

    frame = coerce_numeric(frame)
    time_column, _, _ = infer_column_roles(frame)
    time = _time_seconds(frame, time_column, sample_rate)
    result = frame.copy()
    result["_time_s"] = time
    result = result.dropna(subset=["_time_s"]).sort_values("_time_s")
    result = result.drop_duplicates(subset=["_time_s"], keep="first")
    if len(result) < 2:
        raise DataFormatError("有效时间点少于 2 个。")
    return result.reset_index(drop=True)


def load_edf(path: str | Path) -> tuple[pd.DataFrame, dict[str, Any]]:
    """Load EDF through the optional research dependency MNE."""
    try:
        import mne
    except ImportError as exc:
        raise DataFormatError(
            "读取 EDF 需要安装 MNE：pip install -r requirements-research.txt"
        ) from exc

    raw = mne.io.read_raw_edf(path, preload=True, verbose="ERROR")
    data = raw.get_data().T
    channel_types = raw.get_channel_types()
    names = []
    for index, (name, channel_type) in enumerate(zip(raw.ch_names, channel_types)):
        prefix = channel_type if channel_type in {"eeg", "eog", "emg", "ecg"} else "aux"
        names.append(f"{prefix}_{index}_{name}")
    frame = pd.DataFrame(data, columns=names)
    frame["time_s"] = raw.times
    metadata = {
        "source_format": "edf",
        "sample_rate_hz": float(raw.info["sfreq"]),
        "channel_names": list(raw.ch_names),
        "channel_types": channel_types,
        "duration_s": float(raw.times[-1]) if len(raw.times) else 0.0,
    }
    return prepare_frame(frame), metadata


def load_any(path: str | Path, sample_rate: float | None = None):
    path = Path(path)
    if path.suffix.lower() == ".edf":
        return load_edf(path)
    if path.suffix.lower() in {".csv", ".txt"}:
        return load_csv(path, sample_rate=sample_rate), {"source_format": "csv"}
    raise DataFormatError(f"暂不支持文件类型：{path.suffix}")


from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from typing import Any

import numpy as np
import pandas as pd

from .features import epoch_features
from .io import infer_column_roles, prepare_frame
from .preprocess import (
    estimate_sample_rate,
    filter_eeg_channels,
    filter_eeg_channels_research,
    motion_magnitude,
    resample_frame,
    resample_frame_research,
)
from .quality import (
    channel_quality_table,
    motion_artifacts,
    overall_quality,
)


@dataclass
class PipelineConfig:
    backend: str = "baseline"
    target_rate_hz: float = 128.0
    low_hz: float = 0.5
    high_hz: float = 45.0
    notch_hz: float | None = 50.0
    window_sec: float = 4.0
    step_sec: float = 2.0
    motion_threshold_g: float = 0.25
    motion_units: str = "auto"
    max_motion_ratio_per_epoch: float = 0.5


def _alignment_summary(frame: pd.DataFrame, eeg_channels: list[str], imu_channels: list[str]) -> dict[str, Any]:
    time = frame["_time_s"].to_numpy(dtype=float)
    dt = np.diff(time)
    positive = dt[dt > 0]
    sample_rate = estimate_sample_rate(time)
    expected = max(1, int(round((time[-1] - time[0]) * sample_rate)) + 1) if sample_rate > 0 else len(time)
    missing_ratio = max(0.0, 1.0 - len(time) / expected)
    return {
        "start_s": float(time[0]),
        "end_s": float(time[-1]),
        "duration_s": float(time[-1] - time[0]),
        "estimated_sample_rate_hz": round(sample_rate, 3),
        "median_dt_s": float(np.median(positive)) if len(positive) else 0.0,
        "max_gap_s": float(np.max(positive)) if len(positive) else 0.0,
        "estimated_missing_ratio": round(missing_ratio, 5),
        "eeg_channel_count": len(eeg_channels),
        "imu_channel_count": len(imu_channels),
        "eeg_imu_common_timebase": bool(len(imu_channels) >= 3),
    }


def _preview(frame: pd.DataFrame, eeg_channels: list[str], imu_channels: list[str], max_points: int = 600) -> dict[str, Any]:
    stride = max(1, int(np.ceil(len(frame) / max_points)))
    subset = frame.iloc[::stride]
    time = subset["_time_s"].to_numpy(dtype=float)
    eeg = {channel: subset[channel].round(3).tolist() for channel in eeg_channels[:4]}
    acc = [channel for channel in imu_channels if "acc" in channel.lower()][:3]
    imu = {channel: subset[channel].round(4).tolist() for channel in acc}
    magnitude = motion_magnitude(subset, imu_channels)
    imu["acc_magnitude"] = np.round(magnitude, 4).tolist() if np.isfinite(magnitude).any() else []
    return {
        "time_s": np.round(time, 4).tolist(),
        "eeg": eeg,
        "imu": imu,
    }


def process_dataframe(
    frame: pd.DataFrame,
    config: PipelineConfig | None = None,
    source_name: str = "uploaded.csv",
    metadata: dict[str, Any] | None = None,
) -> tuple[dict[str, Any], pd.DataFrame]:
    config = config or PipelineConfig()
    if config.target_rate_hz <= 0:
        raise ValueError("target_rate_hz 必须大于 0。")
    if config.backend not in {"baseline", "research"}:
        raise ValueError("backend 必须是 baseline 或 research。")

    if "_time_s" not in frame.columns:
        frame = prepare_frame(frame)
    else:
        frame = frame.sort_values("_time_s").drop_duplicates("_time_s").reset_index(drop=True)

    time_column, eeg_channels, imu_channels = infer_column_roles(frame)
    alignment_input = _alignment_summary(frame, eeg_channels, imu_channels)
    original_rate = estimate_sample_rate(frame["_time_s"].to_numpy(dtype=float))
    if config.backend == "research":
        resampled = resample_frame_research(frame, config.target_rate_hz)
        filtered = filter_eeg_channels_research(
            resampled,
            eeg_channels,
            config.target_rate_hz,
            low_hz=config.low_hz,
            high_hz=config.high_hz,
            notch_hz=config.notch_hz,
        )
    else:
        resampled = resample_frame(frame, config.target_rate_hz)
        filtered = filter_eeg_channels(
            resampled,
            eeg_channels,
            config.target_rate_hz,
            low_hz=config.low_hz,
            high_hz=config.high_hz,
            notch_hz=config.notch_hz,
        )

    channel_rows = channel_quality_table(filtered, eeg_channels, config.target_rate_hz)
    magnitude = motion_magnitude(filtered, imu_channels)
    motion = motion_artifacts(
        filtered,
        magnitude,
        imu_channels,
        threshold_g=config.motion_threshold_g,
        units=config.motion_units,
    )
    flags = np.asarray(motion["flags"], dtype=bool)
    feature_rows, epoch_summary = epoch_features(
        filtered,
        eeg_channels,
        config.target_rate_hz,
        flags,
        window_sec=config.window_sec,
        step_sec=config.step_sec,
        max_motion_ratio=config.max_motion_ratio_per_epoch,
    )
    summary = overall_quality(channel_rows, float(motion["artifact_ratio"]))
    alignment = {
        **alignment_input,
        "processed": _alignment_summary(filtered, eeg_channels, imu_channels),
    }

    warnings: list[str] = []
    if original_rate <= 0:
        warnings.append("无法可靠估计原始采样率，请检查时间列。")
    if config.high_hz >= original_rate / 2:
        warnings.append("原始采样率不满足目标高频截止，正式实验需先抗混叠再降采样。")
    if not motion["available"]:
        warnings.append("没有三轴 IMU，无法进行运动伪迹门控。")
    if epoch_summary["kept_windows"] == 0:
        warnings.append("所有窗口均被拒绝，请检查运动阈值或数据质量。")
    if alignment["duration_s"] < 10.0 and config.low_hz < 1.0:
        warnings.append("数据短于 10 秒，0.5 Hz 低通对应的 FIR 可能长于信号，短片段结果仅用于读取联调。")

    report = {
        "schema_version": "0.1",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source": {
            "name": source_name,
            "format": (metadata or {}).get("source_format", "csv"),
            "metadata": metadata or {},
        },
        "config": asdict(config),
        "environment": _environment(config.backend),
        "overview": {
            "input_rows": int(len(frame)),
            "output_rows": int(len(filtered)),
            "eeg_channels": eeg_channels,
            "imu_channels": imu_channels,
            "time_column": time_column,
            "original_sample_rate_hz": round(original_rate, 3),
            "processed_sample_rate_hz": round(estimate_sample_rate(filtered["_time_s"].to_numpy()), 3),
            "duration_s": round(float(filtered["_time_s"].iloc[-1] - filtered["_time_s"].iloc[0]), 3),
        },
        "alignment": alignment,
        "quality": {
            "overall": summary,
            "channels": channel_rows,
            "motion": {
                "available": bool(motion["available"]),
                "artifact_ratio": round(float(motion["artifact_ratio"]), 5),
                "unit_scale_g": motion["unit_scale_g"],
                "baseline_g": motion.get("baseline_g"),
                "threshold_g": motion["threshold_g"],
                "axis_thresholds_g": motion.get("axis_thresholds_g", {}),
                "reason": motion["reason"],
            },
        },
        "epochs": epoch_summary,
        "features": {
            "rows": feature_rows,
            "feature_names": sorted(feature_rows[0].keys()) if feature_rows else [],
        },
        "warnings": warnings,
        "method_notes": (
            [
                "research 后端使用 SciPy 抗混叠重采样和 MNE 零相位 FIR 带通/陷波。",
                "自动质量门控不等于 ICA；伪迹去除实验仍需人工核查或独立模型。",
                "质量评分是可解释的筛查指标，不是医疗诊断或睡眠分期的结论。",
            ]
            if config.backend == "research"
            else [
                "baseline 后端使用频域幅频响应和线性插值，适合数据验收与流程联调。",
                "正式论文实验应切换 research 后端，使用抗混叠重采样和零相位 FIR。",
                "质量评分是可解释的筛查指标，不是医疗诊断或睡眠分期的结论。",
            ]
        ),
        "preview": _preview(filtered, eeg_channels, imu_channels),
    }
    filtered["_motion_artifact"] = flags
    return report, filtered


def _environment(backend: str) -> dict[str, str | None]:
    import platform

    result: dict[str, str | None] = {
        "python": platform.python_version(),
        "backend": backend,
        "numpy": np.__version__,
        "pandas": pd.__version__,
        "scipy": None,
        "mne": None,
    }
    try:
        import scipy

        result["scipy"] = scipy.__version__
    except ImportError:
        pass
    try:
        import mne

        result["mne"] = mne.__version__
    except ImportError:
        pass
    return result


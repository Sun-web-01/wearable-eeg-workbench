from __future__ import annotations

import numpy as np
import pandas as pd


def _relative_power(values: np.ndarray, sample_rate: float, lower: float, upper: float) -> float:
    finite = np.isfinite(values)
    if finite.sum() < 4:
        return 0.0
    x = values[finite] - np.mean(values[finite])
    frequencies = np.fft.rfftfreq(len(x), d=1.0 / sample_rate)
    power = np.abs(np.fft.rfft(x)) ** 2
    total = float(np.sum(power[(frequencies > 0) & (frequencies <= min(80.0, sample_rate / 2))]))
    band = float(np.sum(power[(frequencies >= lower) & (frequencies < upper)]))
    return band / total if total > 0 else 0.0


def channel_quality(values: np.ndarray, sample_rate: float) -> dict[str, float | str | bool]:
    finite = np.isfinite(values)
    clean = values[finite]
    if len(clean) < 4:
        return {
            "valid_ratio": float(finite.mean()) if len(values) else 0.0,
            "flat_ratio": 1.0,
            "clipping_ratio": 0.0,
            "peak_to_peak_uv": 0.0,
            "rms_uv": 0.0,
            "high_frequency_ratio": 0.0,
            "score": 0.0,
            "grade": "D",
            "flatline": True,
        }

    differences = np.diff(clean)
    flat_ratio = float(np.mean(np.abs(differences) < 1e-9)) if len(differences) else 0.0
    minimum, maximum = float(np.min(clean)), float(np.max(clean))
    tolerance = max(1e-9, abs(maximum - minimum) * 1e-6)
    edge_count = int(np.sum(np.isclose(clean, minimum, atol=tolerance)))
    edge_count += int(np.sum(np.isclose(clean, maximum, atol=tolerance)))
    clipping_ratio = min(1.0, edge_count / len(clean))
    p2p = float(np.ptp(clean))
    rms = float(np.sqrt(np.mean(clean**2)))
    hf_ratio = _relative_power(clean, sample_rate, 45.0, min(80.0, sample_rate / 2))

    valid_ratio = float(finite.mean())
    flat_penalty = min(1.0, flat_ratio / 0.10)
    hf_penalty = min(1.0, max(0.0, hf_ratio - 0.05) / 0.45)
    amplitude_penalty = min(1.0, max(0.0, np.log10(max(p2p, 1.0) / 1000.0)))
    score = max(
        0.0,
        100.0
        * valid_ratio
        * (1.0 - 0.45 * flat_penalty)
        * (1.0 - 0.30 * hf_penalty)
        * (1.0 - 0.15 * amplitude_penalty),
    )
    grade = "A" if score >= 85 else "B" if score >= 70 else "C" if score >= 55 else "D"
    return {
        "valid_ratio": valid_ratio,
        "flat_ratio": flat_ratio,
        "clipping_ratio": clipping_ratio,
        "peak_to_peak_uv": p2p,
        "rms_uv": rms,
        "high_frequency_ratio": hf_ratio,
        "score": score,
        "grade": grade,
        "flatline": bool(flat_ratio > 0.5),
    }


def channel_quality_table(
    frame: pd.DataFrame,
    eeg_channels: list[str],
    sample_rate: float,
) -> list[dict[str, float | str | bool]]:
    rows = []
    for channel in eeg_channels:
        row = channel_quality(frame[channel].to_numpy(dtype=float), sample_rate)
        rows.append({"channel": channel, **row})
    return rows


def motion_artifacts(
    frame: pd.DataFrame,
    magnitude: np.ndarray,
    imu_channels: list[str],
    threshold_g: float = 0.25,
    units: str = "auto",
) -> dict[str, object]:
    if not np.isfinite(magnitude).any():
        return {
            "available": False,
            "artifact_ratio": 0.0,
            "motion_ratio": 0.0,
            "unit_scale_g": None,
            "threshold_g": threshold_g,
            "flags": np.zeros(len(frame), dtype=bool),
            "reason": "未识别到三轴加速度计",
        }

    clean = magnitude[np.isfinite(magnitude)]
    median = float(np.median(clean))
    if units == "auto":
        scale = 9.80665 if median > 4.0 else 1.0
    elif units == "m_s2":
        scale = 9.80665
    else:
        scale = 1.0

    magnitude_g = magnitude / scale
    baseline = float(np.median(magnitude_g[np.isfinite(magnitude_g)]))
    flags = np.zeros(len(frame), dtype=bool)
    axis_thresholds: dict[str, float] = {}
    acc_columns = [column for column in imu_channels if "acc" in column.lower()][:3]

    # Magnitude alone misses a pure X/Y head nod because sqrt(x^2+y^2+z^2)
    # changes much less than an individual axis. Detect per-axis deviation.
    for column in acc_columns:
        values = frame[column].to_numpy(dtype=float) / scale
        finite = np.isfinite(values)
        if finite.sum() < 4:
            continue
        axis_baseline = float(np.median(values[finite]))
        deviation = np.abs(values - axis_baseline)
        finite_deviation = deviation[finite]
        mad = float(np.median(np.abs(finite_deviation - np.median(finite_deviation))))
        dynamic_threshold = max(threshold_g, float(np.median(finite_deviation) + 6.0 * mad))
        axis_thresholds[column] = dynamic_threshold
        flags |= np.isfinite(deviation) & (deviation > dynamic_threshold)

    if flags.sum() > 1:
        jerk = np.abs(np.diff(magnitude_g, prepend=np.nan))
        finite_jerk = jerk[np.isfinite(jerk)]
        if len(finite_jerk) > 4:
            jerk_centre = float(np.median(finite_jerk))
            jerk_mad = float(np.median(np.abs(finite_jerk - jerk_centre)))
            jerk_threshold = max(0.08, jerk_centre + 6.0 * jerk_mad)
            flags |= np.isfinite(jerk) & (jerk > jerk_threshold)

    return {
        "available": True,
        "artifact_ratio": float(flags.mean()),
        "motion_ratio": float(flags.mean()),
        "unit_scale_g": scale,
        "baseline_g": baseline,
        "threshold_g": dynamic_threshold,
        "axis_thresholds_g": axis_thresholds,
        "flags": flags,
        "reason": "",
    }


def overall_quality(channel_rows: list[dict], motion_ratio: float) -> dict[str, object]:
    score = float(np.mean([float(row["score"]) for row in channel_rows])) if channel_rows else 0.0
    score *= 1.0 - min(0.25, motion_ratio * 0.5)
    grade = "A" if score >= 85 else "B" if score >= 70 else "C" if score >= 55 else "D"
    reasons = []
    if any(float(row["flat_ratio"]) > 0.1 for row in channel_rows):
        reasons.append("存在明显平直线段")
    if any(float(row["high_frequency_ratio"]) > 0.25 for row in channel_rows):
        reasons.append("高频能量偏高，可能存在肌电或电极噪声")
    if motion_ratio > 0.10:
        reasons.append("运动伪迹比例偏高")
    if not reasons:
        reasons.append("未发现明显全段质量问题")
    return {
        "score": round(score, 2),
        "grade": grade,
        "motion_artifact_ratio": round(motion_ratio, 4),
        "issues": reasons,
        "manual_review_required": score < 70 or motion_ratio > 0.10,
    }


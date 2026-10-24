from __future__ import annotations

import numpy as np
import pandas as pd


BANDS = {
    "delta": (0.5, 4.0),
    "theta": (4.0, 8.0),
    "alpha": (8.0, 13.0),
    "beta": (13.0, 30.0),
    "gamma": (30.0, 45.0),
}


def band_power(values: np.ndarray, sample_rate: float) -> dict[str, float]:
    finite = np.isfinite(values)
    if finite.sum() < 4:
        return {name: 0.0 for name in BANDS}
    x = values[finite] - np.mean(values[finite])
    frequencies = np.fft.rfftfreq(len(x), d=1.0 / sample_rate)
    power = np.abs(np.fft.rfft(x)) ** 2
    total = float(np.sum(power[(frequencies > 0.5) & (frequencies <= 45.0)]))
    result = {}
    for name, (low, high) in BANDS.items():
        energy = float(np.sum(power[(frequencies >= low) & (frequencies < high)]))
        result[f"{name}_power"] = energy
        result[f"{name}_relative"] = energy / total if total > 0 else 0.0
    return result


def epoch_features(
    frame: pd.DataFrame,
    eeg_channels: list[str],
    sample_rate: float,
    motion_flags: np.ndarray,
    window_sec: float = 4.0,
    step_sec: float = 2.0,
    max_motion_ratio: float = 0.5,
) -> tuple[list[dict[str, object]], dict[str, int]]:
    window = max(4, int(round(window_sec * sample_rate)))
    step = max(1, int(round(step_sec * sample_rate)))
    rows: list[dict[str, object]] = []
    rejected = 0
    total = 0

    for start in range(0, max(0, len(frame) - window + 1), step):
        total += 1
        stop = start + window
        motion_ratio = float(np.mean(motion_flags[start:stop])) if motion_flags is not None else 0.0
        if motion_ratio > max_motion_ratio:
            rejected += 1
            continue
        start_time = float(frame["_time_s"].iloc[start])
        for channel in eeg_channels:
            values = frame[channel].iloc[start:stop].to_numpy(dtype=float)
            features = band_power(values, sample_rate)
            rows.append(
                {
                    "epoch_id": f"{start_time:.3f}",
                    "start_s": start_time,
                    "channel": channel,
                    "mean": float(np.nanmean(values)),
                    "std": float(np.nanstd(values)),
                    "rms": float(np.sqrt(np.nanmean(values**2))),
                    "motion_ratio": motion_ratio,
                    **features,
                }
            )
    return rows, {"total_windows": total, "kept_windows": total - rejected, "rejected_windows": rejected}


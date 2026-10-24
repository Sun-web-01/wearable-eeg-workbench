from __future__ import annotations

import numpy as np
import pandas as pd


def estimate_sample_rate(time: np.ndarray) -> float:
    if len(time) < 2:
        return 0.0
    dt = np.diff(time)
    dt = dt[np.isfinite(dt) & (dt > 0)]
    if not len(dt):
        return 0.0
    return float(1.0 / np.median(dt))


def resample_frame(frame: pd.DataFrame, target_rate: float) -> pd.DataFrame:
    if target_rate <= 0:
        raise ValueError("target_rate 必须大于 0。")
    source_time = frame["_time_s"].to_numpy(dtype=float)
    duration = float(source_time[-1] - source_time[0])
    count = max(2, int(np.floor(duration * target_rate)) + 1)
    target_time = np.linspace(source_time[0], source_time[-1], count)
    result = pd.DataFrame({"_time_s": target_time})
    for column in frame.columns:
        if column == "_time_s":
            continue
        if not pd.api.types.is_numeric_dtype(frame[column]):
            source = frame[column].ffill().bfill()
            indices = np.searchsorted(source_time, target_time, side="left")
            indices = np.clip(indices, 0, len(source) - 1)
            result[column] = source.iloc[indices].to_numpy()
            continue
        values = frame[column].to_numpy(dtype=float)
        valid = np.isfinite(values)
        if valid.sum() < 2:
            result[column] = np.nan
        else:
            result[column] = np.interp(target_time, source_time[valid], values[valid])
    return result


def resample_frame_research(frame: pd.DataFrame, target_rate: float) -> pd.DataFrame:
    """Anti-aliased resampling through SciPy."""
    try:
        from math import gcd

        from scipy.signal import resample_poly
    except ImportError as exc:
        raise RuntimeError(
            "research 后端需要 SciPy，请安装 requirements-research.txt。"
        ) from exc

    source_rate = estimate_sample_rate(frame["_time_s"].to_numpy(dtype=float))
    if source_rate <= 0:
        raise ValueError("无法估计原始采样率，不能使用 research 后端重采样。")
    if abs(source_rate - target_rate) < 1e-6:
        return frame.copy()

    ratio = target_rate / source_rate
    denominator = 10_000
    numerator = max(1, int(round(ratio * denominator)))
    common = gcd(numerator, denominator)
    up = numerator // common
    down = denominator // common

    output_length = max(1, int(np.ceil(len(frame) * up / down)))
    result = pd.DataFrame(index=range(output_length))
    for column in frame.columns:
        if column == "_time_s":
            continue
        if not pd.api.types.is_numeric_dtype(frame[column]):
            source = frame[column].ffill().bfill()
            source_time = frame["_time_s"].to_numpy(dtype=float)
            target_time = np.linspace(
                float(source_time[0]),
                float(source_time[-1]),
                output_length,
            )
            indices = np.searchsorted(source_time, target_time, side="left")
            indices = np.clip(indices, 0, len(source) - 1)
            result[column] = source.iloc[indices].to_numpy()
            continue
        values = frame[column].to_numpy(dtype=float)
        finite = np.isfinite(values)
        if finite.sum() < 2:
            resampled = np.full(len(values), np.nan)
        else:
            positions = np.arange(len(values))
            filled = values.copy()
            if not finite.all():
                filled[~finite] = np.interp(positions[~finite], positions[finite], values[finite])
            resampled = resample_poly(filled, up, down)
        if len(resampled) > output_length:
            resampled = resampled[:output_length]
        elif len(resampled) < output_length:
            resampled = np.pad(resampled, (0, output_length - len(resampled)), mode="edge")
        result[column] = resampled

    duration = float(frame["_time_s"].iloc[-1] - frame["_time_s"].iloc[0])
    result["_time_s"] = np.linspace(
        float(frame["_time_s"].iloc[0]),
        float(frame["_time_s"].iloc[0]) + duration,
        len(result),
    )
    return result


def _frequency_filter(
    values: np.ndarray,
    sample_rate: float,
    low_hz: float,
    high_hz: float,
    notch_hz: float | None,
) -> np.ndarray:
    finite = np.isfinite(values)
    if finite.sum() < max(4, int(sample_rate)):
        return values.copy()

    filled = values.copy()
    if not finite.all():
        positions = np.arange(len(values))
        filled[~finite] = np.interp(positions[~finite], positions[finite], values[finite])

    mean = float(np.mean(filled))
    centred = filled - mean
    pad = min(len(centred) - 1, int(sample_rate * 2))
    if pad > 0:
        centred = np.pad(centred, (pad, pad), mode="reflect")

    frequencies = np.fft.rfftfreq(len(centred), d=1.0 / sample_rate)
    spectrum = np.fft.rfft(centred)
    response = np.ones_like(frequencies)
    if low_hz > 0:
        response /= np.sqrt(1.0 + (low_hz / np.maximum(frequencies, 1e-9)) ** 8)
    if high_hz > 0:
        response /= np.sqrt(1.0 + (frequencies / high_hz) ** 8)
    if notch_hz is not None and notch_hz > 0:
        notch = np.exp(-0.5 * ((frequencies - notch_hz) / 1.0) ** 2)
        response *= 1.0 - np.clip(notch, 0.0, 0.98)

    filtered = np.fft.irfft(spectrum * response, n=len(centred))
    if pad > 0:
        filtered = filtered[pad:-pad]
    filtered = filtered + mean
    filtered[~finite] = np.nan
    return filtered


def filter_eeg_channels(
    frame: pd.DataFrame,
    eeg_channels: list[str],
    sample_rate: float,
    low_hz: float = 0.5,
    high_hz: float = 45.0,
    notch_hz: float | None = 50.0,
) -> pd.DataFrame:
    if high_hz >= sample_rate / 2:
        high_hz = max(low_hz + 1.0, sample_rate * 0.45)
    result = frame.copy()
    for channel in eeg_channels:
        result[channel] = _frequency_filter(
            result[channel].to_numpy(dtype=float),
            sample_rate,
            low_hz,
            high_hz,
            notch_hz,
        )
    return result


def filter_eeg_channels_research(
    frame: pd.DataFrame,
    eeg_channels: list[str],
    sample_rate: float,
    low_hz: float = 0.5,
    high_hz: float = 45.0,
    notch_hz: float | None = 50.0,
) -> pd.DataFrame:
    """Use MNE's zero-phase FIR filters for formal analysis runs."""
    try:
        from mne.filter import filter_data, notch_filter
    except ImportError as exc:
        raise RuntimeError(
            "research 后端需要 MNE，请安装 requirements-research.txt。"
        ) from exc

    result = frame.copy()
    if high_hz >= sample_rate / 2:
        high_hz = max(low_hz + 1.0, sample_rate * 0.45)
    data = result[eeg_channels].to_numpy(dtype=float).T
    masks = ~np.isfinite(data)
    for channel in range(data.shape[0]):
        finite = ~masks[channel]
        if finite.sum() < 2:
            continue
        if not finite.all():
            positions = np.arange(data.shape[1])
            data[channel, ~finite] = np.interp(
                positions[~finite], positions[finite], data[channel, finite]
            )
    filtered = filter_data(
        data,
        sfreq=sample_rate,
        l_freq=low_hz,
        h_freq=min(high_hz, sample_rate / 2 - 1e-3),
        method="fir",
        phase="zero",
        fir_design="firwin",
        n_jobs=1,
        verbose=False,
    )
    if notch_hz is not None and 0 < notch_hz < sample_rate / 2:
        filtered = notch_filter(
            filtered,
            Fs=sample_rate,
            freqs=notch_hz,
            n_jobs=1,
            verbose=False,
        )
    filtered[masks] = np.nan
    result[eeg_channels] = filtered.T
    return result


def motion_magnitude(frame: pd.DataFrame, imu_channels: list[str]) -> np.ndarray:
    acc_columns = [column for column in imu_channels if "acc" in column.lower()]
    if len(acc_columns) < 3:
        return np.full(len(frame), np.nan)
    xyz = frame[acc_columns[:3]].to_numpy(dtype=float)
    return np.sqrt(np.sum(xyz**2, axis=1))


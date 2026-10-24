from __future__ import annotations

import numpy as np
import pandas as pd


def generate_demo(seconds: float = 90.0, sample_rate: float = 128.0, seed: int = 42) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    time = np.arange(int(seconds * sample_rate), dtype=float) / sample_rate

    alpha = np.sin(2 * np.pi * 10.0 * time)
    theta = 0.55 * np.sin(2 * np.pi * 6.0 * time + 0.4)
    slow = 0.35 * np.sin(2 * np.pi * 1.2 * time)
    drift = 0.2 * np.sin(2 * np.pi * 0.12 * time)
    eeg_fpz = 12.0 * slow + 7.0 * theta + 2.0 * alpha + drift + rng.normal(0, 1.8, len(time))
    eeg_pz = 5.0 * slow + 3.5 * theta + 10.0 * alpha + drift + rng.normal(0, 1.5, len(time))

    head_motion = np.zeros_like(time)
    for centre, width, amplitude in ((18.0, 0.7, 8.0), (47.0, 1.1, 12.0), (73.0, 0.5, 5.0)):
        head_motion += amplitude * np.exp(-0.5 * ((time - centre) / width) ** 2)
    eeg_fpz += head_motion * 1.8
    eeg_pz += head_motion * 0.8

    acc_x = rng.normal(0, 0.01, len(time))
    acc_y = rng.normal(0, 0.01, len(time))
    acc_z = 1.0 + rng.normal(0, 0.01, len(time))
    acc_x += 0.35 * np.exp(-0.5 * ((time - 18.0) / 0.7) ** 2)
    acc_y += 0.42 * np.exp(-0.5 * ((time - 47.0) / 1.1) ** 2)
    acc_z += 0.30 * np.exp(-0.5 * ((time - 73.0) / 0.5) ** 2)

    state = np.full(len(time), "relaxed", dtype=object)
    state[(time >= 30.0) & (time < 60.0)] = "focused"
    state[time >= 60.0] = "fatigued"

    return pd.DataFrame(
        {
            "time_s": np.round(time, 6),
            "eeg_fpz": np.round(eeg_fpz, 4),
            "eeg_pz": np.round(eeg_pz, 4),
            "acc_x_g": np.round(acc_x, 6),
            "acc_y_g": np.round(acc_y, 6),
            "acc_z_g": np.round(acc_z, 6),
            "state_label": state,
        }
    )

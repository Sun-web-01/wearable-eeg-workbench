"""Wearable EEG/IMU preprocessing and data-quality workbench."""

from .pipeline import PipelineConfig, process_dataframe

__all__ = ["PipelineConfig", "process_dataframe"]
__version__ = "0.1.0"


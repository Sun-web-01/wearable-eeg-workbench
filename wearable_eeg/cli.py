from __future__ import annotations

import argparse
import json
from pathlib import Path

from .io import load_any, load_csv_text
from .labels import attach_sleep_labels, read_mne_annotations
from .pipeline import PipelineConfig, process_dataframe
from .report import write_features_csv, write_html, write_json
from .server import serve
from .synthetic import generate_demo


def _config_from_args(args: argparse.Namespace) -> PipelineConfig:
    return PipelineConfig(
        backend=args.backend,
        target_rate_hz=args.target_rate,
        low_hz=args.low_hz,
        high_hz=args.high_hz,
        notch_hz=None if args.notch_hz <= 0 else args.notch_hz,
        motion_threshold_g=args.motion_threshold,
    )


def _add_processing_args(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "--backend",
        choices=("baseline", "research"),
        default="baseline",
        help="baseline: 零依赖联调；research: SciPy/MNE 正式处理",
    )
    parser.add_argument("--target-rate", type=float, default=128.0)
    parser.add_argument("--low-hz", type=float, default=0.5)
    parser.add_argument("--high-hz", type=float, default=45.0)
    parser.add_argument("--notch-hz", type=float, default=50.0)
    parser.add_argument("--motion-threshold", type=float, default=0.25)


def _write_outputs(report: dict, filtered, output: Path) -> None:
    output.mkdir(parents=True, exist_ok=True)
    json_path = write_json(report, output / "report.json")
    html_path = write_html(report, output / "report.html")
    csv_path = write_features_csv(report, output / "features.csv")
    processed_path = output / "processed.csv"
    filtered.to_csv(processed_path, index=False)
    print(json.dumps({
        "report_json": str(json_path),
        "report_html": str(html_path),
        "features_csv": str(csv_path),
        "processed_csv": str(processed_path),
        "quality_grade": report["quality"]["overall"]["grade"],
        "quality_score": report["quality"]["overall"]["score"],
    }, ensure_ascii=False, indent=2))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="可穿戴 EEG/IMU 数据质量与预处理平台")
    subparsers = parser.add_subparsers(dest="command", required=True)

    demo_parser = subparsers.add_parser("demo", help="生成可复现的演示数据和完整报告")
    demo_parser.add_argument("--output", default="reports/demo")
    demo_parser.add_argument("--seconds", type=float, default=90.0)
    _add_processing_args(demo_parser)

    process_parser = subparsers.add_parser("process", help="处理 CSV/EDF 数据")
    process_parser.add_argument("input")
    process_parser.add_argument("--output", default="reports/latest")
    process_parser.add_argument("--sample-rate", type=float)
    process_parser.add_argument(
        "--annotations",
        help="可选：Sleep-EDF Hypnogram EDF，用于附加 30 秒睡眠分期标签",
    )
    _add_processing_args(process_parser)

    serve_parser = subparsers.add_parser("serve", help="启动本地数据质量 Web 平台")
    serve_parser.add_argument("--host", default="127.0.0.1")
    serve_parser.add_argument("--port", type=int, default=8000)

    args = parser.parse_args(argv)
    if args.command == "serve":
        serve(host=args.host, port=args.port)
        return 0

    if args.command == "demo":
        frame = generate_demo(seconds=args.seconds)
        output = Path(args.output)
        output.mkdir(parents=True, exist_ok=True)
        source_path = output / "demo_input.csv"
        frame.to_csv(source_path, index=False)
        csv_text = source_path.read_text(encoding="utf-8")
        prepared = load_csv_text(csv_text)
        report, filtered = process_dataframe(
            prepared,
            config=_config_from_args(args),
            source_name=source_path.name,
            metadata={"source_format": "synthetic", "purpose": "pipeline_acceptance"},
        )
        _write_outputs(report, filtered, output)
        return 0

    frame, metadata = load_any(args.input, sample_rate=args.sample_rate)
    if args.annotations:
        intervals = read_mne_annotations(args.annotations)
        frame = attach_sleep_labels(frame, intervals)
        metadata["label_source"] = Path(args.annotations).name
        metadata["label_intervals"] = len(intervals)
    report, filtered = process_dataframe(
        frame,
        config=_config_from_args(args),
        source_name=Path(args.input).name,
        metadata=metadata,
    )
    _write_outputs(report, filtered, Path(args.output))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

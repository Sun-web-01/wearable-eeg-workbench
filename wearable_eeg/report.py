from __future__ import annotations

import html
import json
import math
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd


def jsonable(value: Any) -> Any:
    if isinstance(value, dict):
        return {str(key): jsonable(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [jsonable(item) for item in value]
    if isinstance(value, np.ndarray):
        return [jsonable(item) for item in value.tolist()]
    if isinstance(value, (np.integer,)):
        return int(value)
    if isinstance(value, (np.floating, float)):
        return float(value) if math.isfinite(float(value)) else None
    if isinstance(value, (np.bool_,)):
        return bool(value)
    return value


def write_json(report: dict[str, Any], path: str | Path) -> Path:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(jsonable(report), ensure_ascii=False, indent=2, allow_nan=False),
        encoding="utf-8",
    )
    return path


def write_features_csv(report: dict[str, Any], path: str | Path) -> Path:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    pd.DataFrame(report["features"]["rows"]).to_csv(path, index=False)
    return path


def _svg_line(
    values: list[float | None],
    width: int = 760,
    height: int = 180,
    stroke: str = "#2563eb",
    fill: str = "rgba(37,99,235,0.12)",
) -> str:
    clean = [float(value) for value in values if value is not None and math.isfinite(float(value))]
    if len(clean) < 2:
        return '<div class="empty-chart">无有效绘图数据</div>'
    low, high = min(clean), max(clean)
    if high == low:
        high += 1.0
        low -= 1.0
    padding = 14
    points = []
    for index, value in enumerate(values):
        if value is None or not math.isfinite(float(value)):
            continue
        x = padding + index * (width - 2 * padding) / max(1, len(values) - 1)
        y = height - padding - (float(value) - low) * (height - 2 * padding) / (high - low)
        points.append((x, y))
    path = " ".join(
        f"{'M' if index == 0 else 'L'} {x:.2f} {y:.2f}" for index, (x, y) in enumerate(points)
    )
    area = (
        f"{path} L {points[-1][0]:.2f} {height - padding} "
        f"L {points[0][0]:.2f} {height - padding} Z"
    )
    return (
        f'<svg viewBox="0 0 {width} {height}" role="img" aria-label="signal chart">'
        f'<path d="{area}" fill="{fill}"/>'
        f'<path d="{path}" fill="none" stroke="{stroke}" stroke-width="2"/>'
        f"</svg>"
    )


def render_html(report: dict[str, Any], title: str = "EEG/IMU 数据质量报告") -> str:
    overview = report["overview"]
    quality = report["quality"]
    overall = quality["overall"]
    channels = quality["channels"]
    preview = report["preview"]
    eeg_name = next(iter(preview["eeg"]), None)
    eeg_values = preview["eeg"].get(eeg_name, []) if eeg_name else []
    acc_values = preview["imu"].get("acc_magnitude", [])

    channel_rows = "".join(
        (
            "<tr>"
            f"<td>{html.escape(str(row['channel']))}</td>"
            f"<td>{float(row['score']):.1f}</td>"
            f"<td>{html.escape(str(row['grade']))}</td>"
            f"<td>{float(row['peak_to_peak_uv']):.2f}</td>"
            f"<td>{float(row['high_frequency_ratio']) * 100:.2f}%</td>"
            f"<td>{float(row['flat_ratio']) * 100:.2f}%</td>"
            "</tr>"
        )
        for row in channels
    )
    warning_items = "".join(f"<li>{html.escape(item)}</li>" for item in report["warnings"]) or "<li>无</li>"
    issue_items = "".join(f"<li>{html.escape(item)}</li>" for item in overall["issues"])
    return f"""<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{html.escape(title)}</title>
<style>
:root{{--ink:#18212f;--muted:#667085;--line:#dbe2ea;--paper:#f5f7fa;--blue:#2563eb;--green:#16866b}}
*{{box-sizing:border-box}} body{{margin:0;background:var(--paper);color:var(--ink);font-family:"Microsoft YaHei",system-ui,sans-serif}}
main{{max-width:1080px;margin:0 auto;padding:42px 24px 70px}} h1{{font-size:30px;margin:0 0 8px}} h2{{font-size:19px;margin:0 0 14px}}
.sub{{color:var(--muted);margin-bottom:28px}} .grid{{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:22px}}
.card{{background:#fff;border:1px solid var(--line);border-radius:14px;padding:20px;margin-bottom:16px}}
.metric{{font-size:30px;font-weight:700;color:var(--blue)}} .label{{color:var(--muted);font-size:13px}}
.grade{{display:inline-flex;align-items:center;justify-content:center;width:58px;height:58px;border-radius:50%;background:#eaf5f1;color:var(--green);font-size:28px;font-weight:700}}
table{{width:100%;border-collapse:collapse;font-size:14px}} th,td{{text-align:left;padding:10px 8px;border-bottom:1px solid var(--line)}} th{{color:var(--muted);font-weight:500}}
svg{{width:100%;height:auto;display:block}} .chart-title{{font-weight:600;margin-bottom:8px}} .two{{display:grid;grid-template-columns:1fr 1fr;gap:16px}}
ul{{margin:8px 0;padding-left:20px;line-height:1.8}} .note{{font-size:13px;color:var(--muted)}}
@media(max-width:760px){{.grid{{grid-template-columns:1fr 1fr}}.two{{grid-template-columns:1fr}}}}
</style>
</head>
<body><main>
<h1>{html.escape(title)}</h1>
<div class="sub">来源：{html.escape(str(report['source']['name']))} · 生成时间：{html.escape(str(report['generated_at']))}</div>
<section class="grid">
  <div class="card"><div class="label">综合质量</div><div class="grade">{html.escape(str(overall['grade']))}</div><div>{float(overall['score']):.1f} / 100</div></div>
  <div class="card"><div class="label">数据时长</div><div class="metric">{float(overview['duration_s']):.1f}s</div><div class="label">{int(overview['output_rows'])} 个采样点</div></div>
  <div class="card"><div class="label">运动伪迹</div><div class="metric">{float(quality['motion']['artifact_ratio']) * 100:.1f}%</div><div class="label">按 IMU 自动筛查</div></div>
  <div class="card"><div class="label">可用窗口</div><div class="metric">{int(report['epochs']['kept_windows'])}</div><div class="label">共 {int(report['epochs']['total_windows'])} 个</div></div>
</section>
<section class="card"><h2>结论与待处理项</h2><ul>{issue_items}</ul><ul>{warning_items}</ul></section>
<div class="two">
  <section class="card"><div class="chart-title">EEG {html.escape(str(eeg_name or ''))} 滤波后预览</div>{_svg_line(eeg_values)}</section>
  <section class="card"><div class="chart-title">加速度幅值预览</div>{_svg_line(acc_values, stroke="#c76a15", fill="rgba(199,106,21,0.12)")}</section>
</div>
<section class="card"><h2>通道质量</h2><table><thead><tr><th>通道</th><th>评分</th><th>等级</th><th>峰峰值</th><th>高频占比</th><th>平直占比</th></tr></thead><tbody>{channel_rows}</tbody></table></section>
<section class="card"><h2>方法说明</h2><ul>{''.join(f'<li>{html.escape(item)}</li>' for item in report['method_notes'])}</ul></section>
</main></body></html>"""


def write_html(report: dict[str, Any], path: str | Path) -> Path:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(render_html(report), encoding="utf-8")
    return path


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
    data_origin = report.get("data_origin", {})
    glossary = report.get("glossary", {})
    feature_dictionary = report.get("feature_dictionary", {})
    eeg_name = next(iter(preview["eeg"]), None)
    eeg_values = preview["eeg"].get(eeg_name, []) if eeg_name else []
    acc_values = preview["imu"].get("acc_magnitude", [])

    channel_rows = "".join(
        (
            "<tr>"
            f"<td>{html.escape(str(row['channel']))}</td>"
            f"<td>{float(row['score']):.1f}</td>"
            f"<td>{html.escape(str(row['grade']))}</td>"
            f"<td>{float(row['valid_ratio']) * 100:.2f}%</td>"
            f"<td>{float(row['clipping_ratio']) * 100:.2f}%</td>"
            f"<td>{float(row['peak_to_peak_uv']):.2f}</td>"
            f"<td>{float(row['rms_uv']):.2f}</td>"
            f"<td>{float(row['high_frequency_ratio']) * 100:.2f}%</td>"
            f"<td>{float(row['flat_ratio']) * 100:.2f}%</td>"
            "</tr>"
        )
        for row in channels
    )
    warning_items = "".join(f"<li>{html.escape(item)}</li>" for item in report["warnings"]) or "<li>无</li>"
    issue_items = "".join(f"<li>{html.escape(item)}</li>" for item in overall["issues"])
    glossary_items = "".join(
        f"<div><b>{html.escape(str(term))}</b><span>{html.escape(str(description))}</span></div>"
        for term, description in glossary.items()
    )
    feature_items = "".join(
        f"<div><b>{html.escape(str(term))}</b><span>{html.escape(str(description))}</span></div>"
        for term, description in feature_dictionary.items()
    )
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
.origin{{border-left:4px solid var(--blue);background:linear-gradient(120deg,#fff,#f5faff)}}
.tag{{display:inline-block;padding:4px 8px;border-radius:999px;background:#e9f2fc;color:var(--blue);font-size:11px;font-weight:700}}
.origin h2{{margin:10px 0 8px}} .origin p{{margin:6px 0;line-height:1.8}} .origin .purpose{{color:var(--muted);font-size:13px}}
.explain-grid{{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:12px}}
.explain-grid div{{padding:12px;border:1px solid var(--line);border-radius:9px;background:#f9fbfd}}
.explain-grid b,.explain-grid span{{display:block}} .explain-grid b{{font-size:13px}} .explain-grid span{{margin-top:5px;color:var(--muted);font-size:12px;line-height:1.7}}
.column-notes{{display:flex;flex-wrap:wrap;gap:7px;margin-top:12px}}
.column-notes span{{padding:5px 8px;border-radius:6px;background:#f4f7fa;color:var(--muted);font-size:11px}}
.glossary-grid{{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:12px}}
.glossary-grid div{{padding:11px;border:1px solid var(--line);border-radius:8px}}
.glossary-grid b,.glossary-grid span{{display:block}} .glossary-grid span{{margin-top:4px;color:var(--muted);font-size:12px;line-height:1.7}}
@media(max-width:760px){{.grid,.explain-grid,.glossary-grid{{grid-template-columns:1fr 1fr}}.two{{grid-template-columns:1fr}}}}
</style>
</head>
<body><main>
<h1>{html.escape(title)}</h1>
<div class="sub">来源：{html.escape(str(report['source']['name']))} · 生成时间：{html.escape(str(report['generated_at']))}</div>
<section class="card origin">
  <span class="tag">{html.escape(str(data_origin.get('label', '数据来源')))}</span>
  <h2>{html.escape(str(data_origin.get('label', '数据来源与用途')))}</h2>
  <p>{html.escape(str(data_origin.get('summary', '本报告由当前任务输入生成。')))}</p>
  <p class="purpose">用途与限制：{html.escape(str(data_origin.get('purpose', '仅用于团队数据复核，不构成医疗诊断。')))}</p>
</section>
<section class="grid">
  <div class="card"><div class="label">综合质量</div><div class="grade">{html.escape(str(overall['grade']))}</div><div>{float(overall['score']):.1f} / 100</div><div class="note">信号筛查分，不是模型准确率</div></div>
  <div class="card"><div class="label">数据时长</div><div class="metric">{float(overview['duration_s']):.1f}s</div><div class="label">{int(overview['output_rows'])} 个采样点</div><div class="note">连续记录的总时长与点数</div></div>
  <div class="card"><div class="label">运动伪迹</div><div class="metric">{float(quality['motion']['artifact_ratio']) * 100:.1f}%</div><div class="label">按 IMU 自动筛查</div><div class="note">比例会受设备和阈值设置影响</div></div>
  <div class="card"><div class="label">可用窗口</div><div class="metric">{int(report['epochs']['kept_windows'])}</div><div class="label">共 {int(report['epochs']['total_windows'])} 个</div><div class="note">通过运动门控并成功提取特征的片段</div></div>
</section>
<section class="card"><h2>如何阅读这份报告</h2>
  <div class="explain-grid">
    <div><b>先看综合质量</b><span>A 表示当前规则下信号较稳定，不代表脑状态识别一定准确。</span></div>
    <div><b>再看运动伪迹</b><span>数值越高，表示越多的数据被 IMU 判断为剧烈头动。</span></div>
    <div><b>然后看通道质量</b><span>平直线、削顶和高频噪声比例异常时，应先检查电极或采集环境。</span></div>
    <div><b>最后看可用窗口</b><span>只有保留下来的窗口才会进入后续特征与模型实验。</span></div>
  </div>
</section>
<section class="card"><h2>结论与待处理项</h2><ul>{issue_items}</ul><ul>{warning_items}</ul></section>
<div class="two">
  <section class="card"><div class="chart-title">EEG {html.escape(str(eeg_name or ''))} 滤波后预览</div><p class="note">用于观察波形、突发扰动和整体稳定性，不是脑状态结论。</p>{_svg_line(eeg_values)}</section>
  <section class="card"><div class="chart-title">加速度幅值预览</div><p class="note">用于观察头动集中位置；平台据此筛选可疑 EEG 片段。</p>{_svg_line(acc_values, stroke="#c76a15", fill="rgba(199,106,21,0.12)")}</section>
</div>
<section class="card"><h2>通道质量</h2><table><thead><tr><th>通道</th><th>评分</th><th>等级</th><th>有效占比</th><th>削顶占比</th><th>峰峰值 μV</th><th>RMS μV</th><th>高频占比</th><th>平直占比</th></tr></thead><tbody>{channel_rows}</tbody></table>
  <div class="column-notes"><span>有效占比：不是空值的数据比例</span><span>平直：长时间没有变化</span><span>削顶：信号超过记录范围</span><span>高频：可能是肌电或设备噪声</span><span>RMS：总体信号幅度</span></div>
</section>
<section class="card"><h2>术语解释</h2><div class="glossary-grid">{glossary_items}</div></section>
<section class="card"><h2>features.csv 字段说明</h2><p class="note">每个分析窗口会按 EEG 通道输出一行。频段绝对功率适合比较同一设备内的变化，相对功率更适合比较不同通道或不同受试者。</p><div class="glossary-grid">{feature_items}</div></section>
<section class="card"><h2>方法说明</h2><ul>{''.join(f'<li>{html.escape(item)}</li>' for item in report['method_notes'])}</ul></section>
</main></body></html>"""


def write_html(report: dict[str, Any], path: str | Path) -> Path:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(render_html(report), encoding="utf-8")
    return path


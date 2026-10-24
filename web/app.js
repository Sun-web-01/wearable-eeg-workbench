const state = {
  csvText: "",
  filename: "",
  report: null,
  htmlReport: "",
};

const $ = (id) => document.getElementById(id);
const hasCsv = () => Boolean(state.csvText);

function setStatus(message, isError = false) {
  const el = $("status");
  el.textContent = message;
  el.classList.toggle("error", isError);
  el.classList.remove("hidden");
}

function hideStatus() {
  $("status").classList.add("hidden");
}

async function requestJson(url, payload) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

function configPayload() {
  return {
    backend: $("backend").value,
    target_rate_hz: Number($("targetRate").value || 128),
    low_hz: Number($("lowHz").value || 0.5),
    high_hz: Number($("highHz").value || 45),
    notch_hz: Number($("notchHz").value || 0),
    motion_threshold_g: Number($("motionThreshold").value || 0.25),
  };
}

function selectFile(file) {
  state.filename = file.name;
  $("fileMeta").textContent = `正在读取：${file.name}`;
  const reader = new FileReader();
  reader.onload = () => {
    state.csvText = String(reader.result || "");
    $("fileMeta").textContent = `${file.name} · ${(file.size / 1024).toFixed(1)} KB · 已准备处理`;
    $("processBtn").disabled = false;
  };
  reader.onerror = () => setStatus("文件读取失败。", true);
  reader.readAsText(file, "utf-8");
}

function downloadBlob(content, type, filename) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function downloadFeatures() {
  const rows = state.report?.features?.rows || [];
  if (!rows.length) return;
  const columns = Object.keys(rows[0]);
  const csv = [columns.join(","), ...rows.map((row) => columns.map((col) => csvEscape(row[col])).join(","))].join("\n");
  downloadBlob(csv, "text/csv;charset=utf-8", "features.csv");
}

function drawChart(canvas, values, color) {
  const ctx = canvas.getContext("2d");
  const ratio = window.devicePixelRatio || 1;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  canvas.width = Math.max(1, Math.floor(width * ratio));
  canvas.height = Math.max(1, Math.floor(height * ratio));
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const finite = values.map(Number).filter(Number.isFinite);
  if (finite.length < 2) {
    ctx.fillStyle = "#687385";
    ctx.font = "13px Microsoft YaHei";
    ctx.fillText("无有效绘图数据", 12, 28);
    return;
  }
  let low = Math.min(...finite);
  let high = Math.max(...finite);
  if (high === low) { high += 1; low -= 1; }
  const pad = 14;
  const xFor = (i) => pad + i * (width - 2 * pad) / Math.max(1, values.length - 1);
  const yFor = (v) => height - pad - (v - low) * (height - 2 * pad) / (high - low);

  ctx.strokeStyle = "#dbe2e9";
  ctx.lineWidth = 1;
  for (let i = 0; i < 4; i += 1) {
    const y = pad + i * (height - 2 * pad) / 3;
    ctx.beginPath(); ctx.moveTo(pad, y); ctx.lineTo(width - pad, y); ctx.stroke();
  }

  ctx.beginPath();
  let started = false;
  values.forEach((raw, index) => {
    const value = Number(raw);
    if (!Number.isFinite(value)) { started = false; return; }
    const x = xFor(index), y = yFor(value);
    if (!started) { ctx.moveTo(x, y); started = true; } else { ctx.lineTo(x, y); }
  });
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.stroke();
}

function renderResults(data) {
  state.report = data.report;
  state.htmlReport = data.html_report;
  const report = data.report;
  const quality = report.quality;
  const overall = quality.overall;
  $("results").classList.remove("hidden");
  $("qualityGrade").textContent = overall.grade;
  $("qualityScore").textContent = `${overall.score} / 100`;
  $("duration").textContent = `${report.overview.duration_s.toFixed(1)}s`;
  $("rows").textContent = `${report.overview.output_rows} 个重采样点`;
  $("motionRatio").textContent = `${(quality.motion.artifact_ratio * 100).toFixed(1)}%`;
  $("motionThresholdLabel").textContent = quality.motion.available ? `IMU g 阈值 ${Number(quality.motion.threshold_g).toFixed(2)}` : "未识别 IMU";
  $("keptWindows").textContent = String(report.epochs.kept_windows);
  $("windowSummary").textContent = `拒绝 ${report.epochs.rejected_windows} / 共 ${report.epochs.total_windows}`;

  const eegEntries = Object.entries(report.preview.eeg);
  $("eegChartName").textContent = eegEntries[0]?.[0] || "";
  drawChart($("eegChart"), eegEntries[0]?.[1] || [], "#2457c5");
  drawChart($("imuChart"), report.preview.imu.acc_magnitude || [], "#bd601c");

  $("issues").innerHTML = overall.issues.map((item) => `<div>${escapeHtml(item)}</div>`).join("");
  $("warnings").innerHTML = report.warnings.map((item) => `<div>${escapeHtml(item)}</div>`).join("");

  $("channelBody").innerHTML = quality.channels.map((row) => `
    <tr><td>${escapeHtml(row.channel)}</td><td>${Number(row.score).toFixed(1)}</td><td>${escapeHtml(row.grade)}</td>
    <td>${Number(row.peak_to_peak_uv).toFixed(2)}</td><td>${(Number(row.high_frequency_ratio) * 100).toFixed(2)}%</td>
    <td>${(Number(row.flat_ratio) * 100).toFixed(2)}%</td></tr>`).join("");

  const rows = report.features.rows.slice(0, 12);
  const preferred = ["start_s", "channel", "motion_ratio", "alpha_relative", "beta_relative", "theta_relative", "delta_relative"];
  const columns = rows.length ? preferred.filter((column) => Object.hasOwn(rows[0], column)) : [];
  $("featureHead").innerHTML = `<tr>${columns.map((column) => `<th>${escapeHtml(column)}</th>`).join("")}</tr>`;
  $("featureBody").innerHTML = rows.map((row) => `<tr>${columns.map((column) => {
    const value = row[column];
    const text = typeof value === "number" ? (Math.abs(value) < 0.01 ? value.toExponential(2) : value.toFixed(4)) : value;
    return `<td>${escapeHtml(text)}</td>`;
  }).join("")}</tr>`).join("");
  $("featureCount").textContent = `${report.features.rows.length} 行 · 预览前 12 行`;
}

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = String(value ?? "");
  return div.innerHTML;
}

const dropzone = $("dropzone");
const fileInput = $("fileInput");
dropzone.addEventListener("dragover", (event) => { event.preventDefault(); dropzone.classList.add("over"); });
dropzone.addEventListener("dragleave", () => dropzone.classList.remove("over"));
dropzone.addEventListener("drop", (event) => {
  event.preventDefault();
  dropzone.classList.remove("over");
  const file = event.dataTransfer.files[0];
  if (file) selectFile(file);
});
dropzone.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => { if (fileInput.files[0]) selectFile(fileInput.files[0]); });

$("processBtn").addEventListener("click", async () => {
  if (!hasCsv()) return;
  const sampleRate = $("sampleRate").value.trim();
  setStatus("正在处理：重采样、滤波、质量评估与特征提取…");
  try {
    const data = await requestJson("/api/process", {
      filename: state.filename,
      csv_text: state.csvText,
      sample_rate: sampleRate || null,
      config: configPayload(),
    });
    renderResults(data);
    setStatus("处理完成。请先查看质量结论和待处理项，再交接特征文件。");
  } catch (error) {
    setStatus(`处理失败：${error.message}`, true);
  }
});

$("demoBtn").addEventListener("click", async () => {
  setStatus("正在生成可复现演示数据并执行完整处理…");
  try {
    const data = await requestJson("/api/demo", { seconds: 90, config: configPayload() });
    renderResults(data);
    setStatus("演示处理完成。该结果用于验证平台链路，不代表真实受试者结论。");
  } catch (error) {
    setStatus(`演示失败：${error.message}`, true);
  }
});

$("downloadJson").addEventListener("click", () => {
  if (state.report) downloadBlob(JSON.stringify(state.report, null, 2), "application/json;charset=utf-8", "report.json");
});
$("downloadFeatures").addEventListener("click", downloadFeatures);
$("downloadHtml").addEventListener("click", () => {
  if (state.htmlReport) downloadBlob(state.htmlReport, "text/html;charset=utf-8", "report.html");
});

window.addEventListener("resize", () => {
  if (!state.report) return;
  const eeg = Object.values(state.report.preview.eeg)[0] || [];
  drawChart($("eegChart"), eeg, "#2457c5");
  drawChart($("imuChart"), state.report.preview.imu.acc_magnitude || [], "#bd601c");
});

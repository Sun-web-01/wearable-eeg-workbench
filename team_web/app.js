const $ = (id) => document.getElementById(id);

const state = {
  user: null,
  authMode: "login",
  jobs: [],
  selectedFile: null,
  pollTimer: null,
  autoSync: true,
};

function runBootSequence() {
  const overlay = $("bootOverlay");
  if (!overlay) return;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let played = false;
  try {
    played = sessionStorage.getItem("neuroteam:booted") === "1";
  } catch {
    played = false;
  }
  if (played || reducedMotion) {
    overlay.remove();
    return;
  }

  document.body.classList.add("boot-active");
  const statuses = [
    "建立安全会话",
    "校验 EEG / IMU 通道",
    "加载信号质量规则",
    "准备团队工作区",
  ];
  let statusIndex = 0;
  let finished = false;
  const statusTimer = setInterval(() => {
    statusIndex = Math.min(statusIndex + 1, statuses.length - 1);
    $("bootStatus").textContent = statuses[statusIndex];
  }, 560);

  const finish = () => {
    if (finished) return;
    finished = true;
    clearInterval(statusTimer);
    document.body.classList.remove("boot-active");
    overlay.classList.add("done");
    try {
      sessionStorage.setItem("neuroteam:booted", "1");
    } catch {
      // Continue without persistence when storage is unavailable.
    }
    setTimeout(() => overlay.remove(), 780);
  };

  overlay.addEventListener("click", finish, { once: true });
  setTimeout(finish, 3300);
}

async function api(path, options = {}) {
  const response = await fetch(path, { credentials: "same-origin", ...options });
  if (response.status === 401) {
    showAuth();
    throw new Error("请重新登录");
  }
  const type = response.headers.get("content-type") || "";
  const data = type.includes("application/json") ? await response.json() : null;
  if (!response.ok) throw new Error(data?.detail || data?.error || `HTTP ${response.status}`);
  return data;
}

function setAuthMode(mode) {
  state.authMode = mode;
  document.querySelectorAll("[data-auth-tab]").forEach((button) => {
    button.classList.toggle("active", button.dataset.authTab === mode);
  });
  document.querySelectorAll(".register-only").forEach((element) => {
    element.classList.toggle("hidden", mode !== "register");
  });
  $("authSubmit").textContent = mode === "login" ? "登录平台" : "注册并加入团队";
  $("authHeading").textContent = mode === "login" ? "登录团队工作台" : "加入团队工作台";
  $("authDescription").textContent = mode === "login"
    ? "进入后可查看共享任务、提交数据并复核处理报告。"
    : "使用团队邀请码创建个人账户，之后即可查看团队数据和实验记录。";
  $("passwordHint").textContent = mode === "login" ? "请输入账户密码" : "至少 8 位";
  $("password").autocomplete = mode === "login" ? "current-password" : "new-password";
  $("authError").classList.add("hidden");
  $("authError").textContent = "";
}

function showAuth() {
  state.user = null;
  clearInterval(state.pollTimer);
  $("appShell").classList.add("hidden");
  $("authShell").classList.remove("hidden");
  $("password").value = "";
}

function showApp(user) {
  state.user = user;
  $("authShell").classList.add("hidden");
  $("appShell").classList.remove("hidden");
  $("currentUser").textContent = user.username;
  $("avatar").textContent = user.username.slice(0, 1).toUpperCase();
  setView("jobs");
  loadJobs();
  applyAutoSync(state.autoSync);
}

function updateAccountHeader(user) {
  state.user = user;
  $("currentUser").textContent = user.username;
  $("avatar").textContent = user.username.slice(0, 1).toUpperCase();
}

function showAccountMessage(message, error = false) {
  const element = $("accountMessage");
  element.textContent = message;
  element.classList.toggle("error", error);
  element.classList.remove("hidden");
}

function openAccountDialog() {
  if (!state.user) return;
  $("accountUsername").value = state.user.username;
  $("accountCurrentPassword").value = "";
  $("accountNewPassword").value = "";
  $("accountConfirmPassword").value = "";
  $("accountMessage").classList.add("hidden");
  $("accountDialog").showModal();
  $("accountCurrentPassword").focus();
}

function readAutoSyncPreference() {
  try {
    return localStorage.getItem("neuroteam:auto-sync") !== "off";
  } catch {
    return true;
  }
}

function applyAutoSync(enabled) {
  state.autoSync = enabled;
  clearInterval(state.pollTimer);
  if (enabled && state.user) {
    state.pollTimer = setInterval(loadJobs, 3500);
  }
  const toggle = $("syncToggle");
  toggle.classList.toggle("on", enabled);
  toggle.classList.toggle("off", !enabled);
  toggle.setAttribute("aria-pressed", String(enabled));
  toggle.querySelector("span").textContent = enabled ? "自动同步" : "自动同步已关闭";
  toggle.title = enabled ? "点击关闭任务自动刷新" : "点击开启任务自动刷新";
  try {
    localStorage.setItem("neuroteam:auto-sync", enabled ? "on" : "off");
  } catch {
    // Browser privacy settings may disable storage.
  }
}

function showMessage(message, error = false) {
  const element = $("uploadMessage");
  element.textContent = message;
  element.classList.toggle("error", error);
  element.classList.toggle("loading", !error && /正在|上传中/.test(message));
  element.classList.remove("hidden");
}

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = String(value ?? "");
  return div.innerHTML;
}

function formatTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function statusLabel(status) {
  return {
    queued: "排队中",
    processing: "处理中",
    completed: "已完成",
    failed: "失败",
  }[status] || status;
}

function backendLabel(backend) {
  return backend === "research" ? "正式科研" : "快速预览";
}

function qualityLabel(grade) {
  return {
    A: "较可靠",
    B: "可用，建议复核",
    C: "偏低，需要复核",
    D: "需重新处理",
  }[grade] || "待评估";
}

function animateMetric(id, value) {
  const element = $(id);
  const target = Number(value) || 0;
  const current = Number(element.textContent) || 0;
  if (current === target) return;
  const started = performance.now();
  const duration = 320;
  const draw = (now) => {
    const progress = Math.min((now - started) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    element.textContent = Math.round(current + (target - current) * eased);
    if (progress < 1) requestAnimationFrame(draw);
  };
  requestAnimationFrame(draw);
}

function renderJobs(data) {
  state.jobs = data.jobs;
  animateMetric("statTotal", data.stats.total);
  animateMetric("statCompleted", data.stats.completed);
  animateMetric("statProcessing", data.stats.processing);
  animateMetric("statFailed", data.stats.failed);

  if (!data.jobs.length) {
    $("jobsBody").innerHTML = '<tr><td colspan="8" class="empty">还没有任务。上传数据或创建一个演示任务。</td></tr>';
    return;
  }

  $("jobsBody").innerHTML = data.jobs.map((job) => `
    <tr>
      <td>
        <span class="task-name">${escapeHtml(job.title)}</span>
        <span class="subline">${escapeHtml(job.input_name || "系统演示数据")}</span>
      </td>
      <td>${escapeHtml(job.owner_name)}</td>
      <td>${escapeHtml(job.input_name || "系统演示数据")}</td>
      <td>${backendLabel(job.backend)}</td>
      <td><span class="badge ${job.status}">${statusLabel(job.status)}</span></td>
      <td>${job.quality_grade
        ? `<span class="badge ${job.quality_grade}" title="${qualityLabel(job.quality_grade)}">${job.quality_grade} · ${Number(job.quality_score).toFixed(1)}</span>`
        : "—"}</td>
      <td>${formatTime(job.created_at)}</td>
      <td><button class="link-button" data-job-id="${job.id}">详情</button></td>
    </tr>`).join("");

  document.querySelectorAll("[data-job-id]").forEach((button) => {
    button.addEventListener("click", () => openJob(button.dataset.jobId));
  });
}

async function loadJobs() {
  if (!state.user) return;
  try {
    renderJobs(await api("/api/jobs"));
  } catch (error) {
    if (error.message !== "请重新登录") showMessage(`任务读取失败：${error.message}`, true);
  }
}

function configFromForm() {
  return {
    backend: $("backend").value,
    target_rate_hz: Number($("targetRate").value),
    low_hz: Number($("lowHz").value),
    high_hz: Number($("highHz").value),
    notch_hz: Number($("notchHz").value),
    motion_threshold_g: Number($("motionThreshold").value),
  };
}

function formatDateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatRatio(value) {
  const number = Number(value);
  return Number.isFinite(number) ? `${(number * 100).toFixed(1)}%` : "—";
}

function formatSeconds(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return number < 1 ? `${(number * 1000).toFixed(1)} ms` : `${number.toFixed(2)} s`;
}

function qualityDescription(grade) {
  return {
    A: "整体信号较稳定，可进入后续特征提取与模型对照；仍建议结合通道和运动伪迹明细检查。",
    B: "数据总体可用，但存在需要人工确认的片段。建议先复核异常窗口，再进入模型训练。",
    C: "信号质量偏低，可能有较多噪声、缺口或运动伪迹。建议调整采集或处理参数后重试。",
    D: "当前数据不适合直接进入模型，请检查通道、时间轴、采样率和运动伪迹后重新处理。",
  }[grade] || "报告尚未生成或质量等级不可用。";
}

function sourceFormatLabel(value) {
  return {
    synthetic: "系统合成演示数据",
    csv: "CSV 表格数据",
    edf: "EDF 生理信号",
  }[String(value || "").toLowerCase()] || value || "已上传文件";
}

function downloadFileName(job, label, extension) {
  let base = String(job.title || "EEG任务")
    .replace(/\.(csv|edf)$/i, "")
    .replace(/[<>:"/\\|?*]/g, "_")
    .replace(/^[ ._]+|[ ._]+$/g, "")
    .slice(0, 80) || "EEG任务";
  const date = String(job.created_at || "").slice(0, 10) || "未注明日期";
  return `${base}_${date}_${String(job.id).slice(0, 6)}_${label}.${extension}`;
}

async function openJob(jobId) {
  const dialog = $("jobDialog");
  $("dialogTitle").textContent = "正在读取任务…";
  $("dialogContent").innerHTML = "";
  dialog.showModal();
  try {
    const data = await api(`/api/jobs/${jobId}`);
    const job = data.job;
    let report = null;
    if (job.has_report && job.status === "completed") {
      try {
        report = await api(`/api/jobs/${job.id}/report`);
      } catch {
        report = null;
      }
    }

    $("dialogTitle").textContent = job.title;
    const overview = report?.overview || {};
    const alignment = report?.alignment?.processed || report?.alignment || {};
    const overall = report?.quality?.overall || {};
    const motion = report?.quality?.motion || {};
    const epochs = report?.epochs || {};
    const config = job.config || {};
    const channels = Array.isArray(report?.quality?.channels) ? report.quality.channels : [];
    const issues = Array.isArray(overall.issues) ? overall.issues : [];
    const grade = job.quality_grade || overall.grade || "—";
    const scoreValue = Number(overall.score ?? job.quality_score);
    const score = Number.isFinite(scoreValue) ? Math.max(0, Math.min(100, scoreValue)) : 0;
    const eegChannels = Array.isArray(overview.eeg_channels) ? overview.eeg_channels : [];
    const imuChannels = Array.isArray(overview.imu_channels) ? overview.imu_channels : [];
    const keptWindows = Number(epochs.kept_windows ?? 0);
    const totalWindows = Number(epochs.total_windows ?? 0);
    const artifactRatio = overall.motion_artifact_ratio ?? motion.artifact_ratio;
    const completed = job.status === "completed" && report;
    const sourceFormat = sourceFormatLabel(
      overview.source_format || report?.source?.format || (job.mode === "demo" ? "synthetic" : "已上传文件"),
    );
    const reportLink = completed
      ? `<a class="ghost small" href="/api/jobs/${job.id}/view" target="_blank" rel="noreferrer">在线查看质量报告</a>`
      : "";
    const channelRows = channels.map((channel) => `
      <tr>
        <td><span class="task-name">${escapeHtml(channel.channel)}</span></td>
        <td>${formatRatio(channel.valid_ratio)}</td>
        <td>${formatRatio(channel.flat_ratio)}</td>
        <td>${formatRatio(channel.clipping_ratio)}</td>
        <td>${formatRatio(channel.high_frequency_ratio)}</td>
        <td>${Number.isFinite(Number(channel.rms_uv)) ? `${Number(channel.rms_uv).toFixed(2)} μV` : "—"}</td>
        <td><span class="badge ${escapeHtml(channel.grade || "")}">${escapeHtml(channel.grade || "—")}</span></td>
      </tr>`).join("");
    const artifacts = [
      ["report.html", "质量报告", "html", "适合在浏览器中阅读和归档"],
      ["report.json", "分析报告", "json", "包含参数与质量结果，适合程序读取"],
      ["features.csv", "窗口特征", "csv", "每个时间窗口的频带功率与质量指标"],
      ["processed.csv", "处理后数据", "csv", "完成滤波、重采样和标记后的信号"],
    ];
    const downloadCards = completed ? artifacts.map(([artifact, label, extension, description]) => {
      const filename = downloadFileName(job, label, extension);
      return `
        <a class="download-card" href="/api/jobs/${job.id}/download/${artifact}" download="${escapeHtml(filename)}">
          <span class="download-format">${extension.toUpperCase()}</span>
          <span class="download-copy"><strong>${label}</strong><small>${escapeHtml(filename)}</small><em>${description}</em></span>
          <b aria-hidden="true">↓</b>
        </a>`;
    }).join("") : "";
    $("dialogContent").innerHTML = `
      <div class="detail-summary">
        <div class="quality-gauge grade-${escapeHtml(grade)}" style="--quality-score:${score}">
          <div><strong>${escapeHtml(grade)}</strong><span>${score ? score.toFixed(1) : "—"}</span><small>质量分</small></div>
        </div>
        <div class="detail-summary-copy">
          <div class="detail-status-line">
            <span class="badge ${job.status}">${statusLabel(job.status)}</span>
            <span class="detail-mode">${backendLabel(job.backend)}</span>
            <span class="detail-id">任务 ${escapeHtml(job.id)}</span>
          </div>
          <h3>${grade === "—" ? "等待质量报告" : `信号质量 ${grade} · ${qualityLabel(grade)}`}</h3>
          <p>${qualityDescription(grade)}</p>
          <div class="detail-inline">
            <span>提交者 ${escapeHtml(job.owner_name)}</span>
            <span>创建于 ${formatDateTime(job.created_at)}</span>
          </div>
        </div>
        ${reportLink}
      </div>

      <div class="detail-metric-grid">
        <div><span>数据时长</span><strong>${job.duration_s ? `${Number(job.duration_s).toFixed(1)} 秒` : "—"}</strong><small>可分析的有效时长</small></div>
        <div><span>目标采样率</span><strong>${Number(overview.processed_sample_rate_hz || config.target_rate_hz || 0).toFixed(0)} Hz</strong><small>每秒保留的数据点</small></div>
        <div><span>通道数量</span><strong>${eegChannels.length} EEG / ${imuChannels.length} IMU</strong><small>脑电与运动传感器</small></div>
        <div><span>可用窗口</span><strong>${keptWindows} / ${totalWindows}</strong><small>保留 / 全部分析窗口</small></div>
        <div><span>运动伪迹</span><strong>${formatRatio(artifactRatio)}</strong><small>被 IMU 标记的时间比例</small></div>
        <div><span>输入规模</span><strong>${Number(overview.input_rows || 0).toLocaleString("zh-CN")}</strong><small>原始数据行数</small></div>
      </div>

      ${job.error ? `<div class="auth-error">${escapeHtml(job.error)}</div>` : ""}

      <div class="detail-section-grid">
        <section class="detail-card">
          <span class="eyebrow">输入与身份</span>
          <h3>数据来源</h3>
          <dl class="detail-list">
            <div><dt>输入文件</dt><dd>${escapeHtml(job.input_name || "系统演示数据")}</dd></div>
            <div><dt>数据格式</dt><dd>${escapeHtml(sourceFormat)}</dd></div>
            <div><dt>处理完成</dt><dd>${formatDateTime(job.finished_at)}</dd></div>
            <div><dt>文件指纹</dt><dd class="hash-value">${escapeHtml(job.input_sha256 || "未记录")}</dd></div>
          </dl>
        </section>

        <section class="detail-card">
          <span class="eyebrow">参数快照</span>
          <h3>处理参数</h3>
          <dl class="detail-list">
            <div><dt>处理模式</dt><dd>${backendLabel(job.backend)}</dd></div>
            <div><dt>带通滤波</dt><dd>${config.low_hz ?? "—"}–${config.high_hz ?? "—"} Hz</dd></div>
            <div><dt>工频陷波</dt><dd>${config.notch_hz ? `${config.notch_hz} Hz` : "关闭"}</dd></div>
            <div><dt>运动阈值</dt><dd>${config.motion_threshold_g ?? "—"} g</dd></div>
            <div><dt>窗口设置</dt><dd>${config.window_sec ?? "—"} 秒窗 / ${config.step_sec ?? "—"} 秒步长</dd></div>
          </dl>
        </section>

        <section class="detail-card">
          <span class="eyebrow">时间与完整性</span>
          <h3>对齐检查</h3>
          <dl class="detail-list">
            <div><dt>EEG–IMU 时间轴</dt><dd>${alignment.eeg_imu_common_timebase ? "已对齐" : "未确认"}</dd></div>
            <div><dt>最大时间缺口</dt><dd>${formatSeconds(alignment.max_gap_s)}</dd></div>
            <div><dt>估计缺失比例</dt><dd>${formatRatio(alignment.estimated_missing_ratio)}</dd></div>
            <div><dt>窗口拒绝数</dt><dd>${epochs.rejected_windows ?? "—"}</dd></div>
          </dl>
        </section>

        <section class="detail-card">
          <span class="eyebrow">质量提示</span>
          <h3>需要关注的信号</h3>
          <p class="detail-note">${overall.manual_review_required ? "报告建议人工复核以下内容。" : "未要求强制人工复核，仍建议结合原始波形确认。"}</p>
          <ul class="issue-list">${(issues.length ? issues : ["未报告明显全段质量问题。"]).map((issue) => `<li>${escapeHtml(issue)}</li>`).join("")}</ul>
        </section>
      </div>

      ${channels.length ? `
        <section class="detail-card channel-section">
          <div class="section-heading"><div><span class="eyebrow">逐通道检查</span><h3>通道质量</h3></div><p>有效比例越高、平坦和削顶比例越低，通常越适合进入建模。</p></div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>通道</th><th>有效比例</th><th>平直比例</th><th>削顶比例</th><th>高频噪声</th><th>RMS 幅度</th><th>等级</th></tr></thead>
              <tbody>${channelRows}</tbody>
            </table>
          </div>
        </section>` : ""}

      ${completed ? `
        <section class="detail-card downloads-section">
          <div class="section-heading"><div><span class="eyebrow">结果交付</span><h3>下载处理结果</h3></div><p>文件名包含任务名称、日期和文件用途，方便直接归档。</p></div>
          <div class="download-grid">${downloadCards}</div>
        </section>` : `<div class="detail-empty">${job.status === "failed" ? "任务失败，暂无结果文件。" : "报告仍在生成，完成后再下载结果。"}</div>`}

      <section class="detail-card timeline-section">
        <span class="eyebrow">过程记录</span>
        <h3>事件时间线</h3>
        <div class="detail-timeline">
          ${data.events.map((event, index) => `<div><i>${String(index + 1).padStart(2, "0")}</i><p>${escapeHtml(event.message)}<time>${formatDateTime(event.created_at)}</time></p></div>`).join("")}
        </div>
      </section>`;
  } catch (error) {
    $("dialogTitle").textContent = "任务读取失败";
    $("dialogContent").innerHTML = `<div class="auth-error">${escapeHtml(error.message)}</div>`;
  }
}

const datasetTaskLabels = {
  sleep_staging: "睡眠分期",
  sleep_staging_multimodal: "多模态睡眠分期",
  sleep_multimodal: "可穿戴睡眠多模态",
  workload_relaxed_vs_task: "认知负荷识别",
  drowsiness_grading: "嗜睡分级",
  motion_artifact_benchmark: "运动伪迹基准",
  eeg_imu_synchronisation: "EEG–IMU 同步",
};

const datasetAccessLabels = {
  open_download: "开放下载",
  restricted_health_data: "受限健康数据",
  request_from_source: "向来源申请",
  request_from_lab: "向实验室申请",
  verify_from_primary_source: "需核对原始来源",
};

const datasetModalityLabels = {
  EEG: "EEG 脑电",
  EOG: "EOG 眼电",
  EMG: "EMG 肌电",
  ECG: "ECG 心电",
  IMU: "IMU 运动",
  ACC: "ACC 加速度",
  PPG: "PPG 脉搏波",
  EDA: "EDA 皮肤电",
  temperature: "皮肤温度",
  derived_HR: "心率",
  KSS: "KSS 嗜睡评分",
  NASA_TLX_like_scores: "主观负荷评分",
  first_person_video: "第一视角视频",
  wearable_EEG_label_source: "可穿戴 EEG 标签源",
  dry_electrode_EEG: "干电极 EEG",
};

const datasetGuidance = {
  sleep_edf_expanded: "先核对许可和样本清单，再下载单个受试者完成预处理验收。",
  hmc_sleep: "适合在基线稳定后作为异质人群的验证数据。",
  bidsleep: "先下载一名受试者，确认加速度采样率和是否包含原始脑电波形。",
  dreamt: "尽早申请访问权限；原始受限数据不得重新分发。",
  stew: "先确认数据申请方式和许可条款，再开展认知负荷实验。",
  drozy: "先确认嗜睡评分与标签映射，再向实验室申请数据。",
  wearbci: "从论文和原始来源核对下载方式、许可、IMU 通道及采样率。",
  physionet_multimodal_gait: "找到准确的 PhysioNet 页面并记录许可后再下载。",
};

const datasetLicenseLabels = {
  "ODC-BY-1.0": "ODC-BY-1.0（开放数据署名许可）",
  "CC-BY-4.0": "CC BY 4.0（署名许可）",
  "PhysioNet Restricted Health Data License 1.5.0": "PhysioNet 受限健康数据许可 1.5.0",
  verify_before_use: "使用前核对许可",
};

const datasetChannelLabels = {
  "2 EEG: Fpz-Cz, Pz-Oz": "2 路 EEG：Fpz-Cz、Pz-Oz",
  "4 EEG plus EOG/EMG/ECG": "4 路 EEG + 眼电/肌电/心电",
  "Dreem 2 labels; Apple Watch 3-axis ACC and HR": "Dreem 2 睡眠标签；Apple Watch 三轴加速度与心率",
  "Empatica E4 multi-stream plus PSG-derived sleep labels": "Empatica E4 多路信号 + PSG 派生睡眠标签",
  "14 EEG, Emotiv EPOC layout": "14 路 EEG，Emotiv EPOC 布局",
  "5 EEG": "5 路 EEG",
  "see dataset documentation": "见数据集说明",
  "EEG plus 17 IMUs": "EEG + 17 个 IMU",
};

async function loadDatasets() {
  if (!state.user) return;
  try {
    const data = await api("/api/datasets");
    $("datasetGrid").innerHTML = data.datasets.map((dataset) => {
      const task = datasetTaskLabels[dataset.task] || dataset.task;
      const access = datasetAccessLabels[dataset.access] || dataset.access;
      const guidance = datasetGuidance[dataset.id] || dataset.first_action;
      const priority = dataset.priority === "P0" ? "优先验证" : "备选资源";
      const license = datasetLicenseLabels[dataset.license] || dataset.license;
      const channels = datasetChannelLabels[dataset.channels] || dataset.channels;
      const modalities = (dataset.modalities || [])
        .map((item) => `<span>${escapeHtml(datasetModalityLabels[item] || item)}</span>`)
        .join("");
      return `
        <article class="dataset-card">
          <div class="top">
            <span class="badge ${dataset.priority === "P0" ? "A" : ""}">${escapeHtml(dataset.priority)} · ${priority}</span>
            <span class="badge">${escapeHtml(task)}</span>
          </div>
          <h3>${escapeHtml(dataset.name)}</h3>
          <p>${escapeHtml(guidance)}</p>
          <div class="modality-list">${modalities}</div>
          <div class="dataset-meta">
            <span>通道：${escapeHtml(channels)}</span>
            <span>${dataset.sample_rate_hz ? `${dataset.sample_rate_hz} Hz` : "采样率待确认"}</span>
            <span>${escapeHtml(access)}</span>
            <span>${escapeHtml(license)}</span>
          </div>
          ${dataset.official_url
            ? `<a href="${escapeHtml(dataset.official_url)}" target="_blank" rel="noreferrer">打开官方数据页 ↗</a>`
            : ""}
        </article>`;
    }).join("");
  } catch (error) {
    $("datasetGrid").innerHTML = `<div class="auth-error">${escapeHtml(error.message)}</div>`;
  }
}

function setView(view) {
  document.querySelectorAll(".view").forEach((element) => element.classList.add("hidden"));
  document.querySelectorAll(".nav-item").forEach((button) => {
    const active = button.dataset.view === view;
    button.classList.toggle("active", active);
    button.toggleAttribute("aria-current", active);
  });
  $(`${view}View`).classList.remove("hidden");
  const labels = {
    jobs: ["任务工作台", "数据从这里进入模型", "上传 EEG/IMU 数据，由服务端完成质量检查、预处理与可追溯报告。"],
    datasets: ["数据资源", "公开数据集", "核对来源、许可和访问权限，再选择适合当前实验的数据。"],
    protocol: ["团队规范", "数据与实验约定", "让数据来源、处理参数和被试划分都可以被团队复核。"],
  };
  $("viewLabel").textContent = labels[view][0];
  $("pageTitle").textContent = labels[view][1];
  $("pageSubtitle").textContent = labels[view][2];
  if (view === "datasets") loadDatasets();
}

document.querySelectorAll("[data-auth-tab]").forEach((button) => {
  button.addEventListener("click", () => setAuthMode(button.dataset.authTab));
});

document.querySelectorAll(".nav-item").forEach((button) => {
  button.addEventListener("click", () => setView(button.dataset.view));
});

$("authForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("authError").classList.add("hidden");
  const path = state.authMode === "login" ? "/api/auth/login" : "/api/auth/register";
  try {
    const data = await api(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: $("username").value.trim(),
        password: $("password").value,
        invite_code: $("inviteCode").value,
      }),
    });
    $("password").value = "";
    showApp(data.user);
  } catch (error) {
    $("authError").textContent = error.message;
    $("authError").classList.remove("hidden");
  }
});

$("logoutBtn").addEventListener("click", async () => {
  await api("/api/auth/logout", { method: "POST" });
  showAuth();
});

$("accountBtn").addEventListener("click", openAccountDialog);
$("closeAccountDialog").addEventListener("click", () => $("accountDialog").close());
$("cancelAccountBtn").addEventListener("click", () => $("accountDialog").close());
$("accountDialog").addEventListener("click", (event) => {
  if (event.target === $("accountDialog")) $("accountDialog").close();
});

$("accountForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const newUsername = $("accountUsername").value.trim();
  const currentPassword = $("accountCurrentPassword").value;
  const newPassword = $("accountNewPassword").value;
  const confirmPassword = $("accountConfirmPassword").value;
  if (newPassword !== confirmPassword) {
    showAccountMessage("两次输入的新密码不一致。", true);
    return;
  }
  const originalText = $("saveAccountBtn").textContent;
  $("saveAccountBtn").disabled = true;
  $("saveAccountBtn").textContent = "正在保存…";
  try {
    const data = await api("/api/account", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        current_password: currentPassword,
        new_username: newUsername,
        new_password: newPassword || null,
      }),
    });
    updateAccountHeader(data.user);
    $("accountUsername").value = data.user.username;
    $("accountCurrentPassword").value = "";
    $("accountNewPassword").value = "";
    $("accountConfirmPassword").value = "";
    showAccountMessage("账户设置已保存，下次登录请使用新的用户名和密码。");
    loadJobs();
  } catch (error) {
    showAccountMessage(error.message, true);
  } finally {
    $("saveAccountBtn").disabled = false;
    $("saveAccountBtn").textContent = originalText;
  }
});

$("syncToggle").addEventListener("click", () => {
  const enabled = !state.autoSync;
  applyAutoSync(enabled);
  if (enabled) loadJobs();
});

const dropzone = $("teamDropzone");
dropzone.addEventListener("click", () => $("dataFile").click());
dropzone.addEventListener("dragover", (event) => event.preventDefault());
dropzone.addEventListener("drop", (event) => {
  event.preventDefault();
  if (event.dataTransfer.files[0]) setDataFile(event.dataTransfer.files[0]);
});
$("dataFile").addEventListener("change", () => {
  if ($("dataFile").files[0]) setDataFile($("dataFile").files[0]);
});

function setDataFile(file) {
  state.selectedFile = file;
  $("dataFileName").textContent = `${file.name} · ${(file.size / 1024 / 1024).toFixed(2)} MB`;
  dropzone.classList.add("selected");
  if (!$("jobTitle").value) $("jobTitle").value = file.name.replace(/\.[^.]+$/, "");
}

$("uploadForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!state.selectedFile) {
    showMessage("请先选择 CSV 或 EDF 文件。", true);
    return;
  }
  const form = new FormData();
  form.append("file", state.selectedFile);
  if ($("annotationFile").files[0]) form.append("annotations", $("annotationFile").files[0]);
  form.append("title", $("jobTitle").value);
  Object.entries(configFromForm()).forEach(([key, value]) => form.append(key, String(value)));
  const originalText = $("uploadBtn").textContent;
  $("uploadBtn").disabled = true;
  $("uploadBtn").textContent = "正在上传…";
  showMessage("正在上传并创建处理任务…");
  try {
    const data = await api("/api/jobs/upload", { method: "POST", body: form });
    showMessage(`任务已进入队列：${data.job.id}`);
    state.selectedFile = null;
    $("dataFile").value = "";
    $("dataFileName").textContent = "CSV：时间序列表格；EDF：常规生理信号文件";
    dropzone.classList.remove("selected");
    loadJobs();
  } catch (error) {
    showMessage(`提交失败：${error.message}`, true);
  } finally {
    $("uploadBtn").disabled = false;
    $("uploadBtn").textContent = originalText;
  }
});

$("demoBtn").addEventListener("click", async () => {
  const originalText = $("demoBtn").textContent;
  $("demoBtn").disabled = true;
  $("demoBtn").textContent = "正在创建…";
  try {
    showMessage("正在创建团队演示任务…");
    const data = await api("/api/jobs/demo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "团队演示 · 正式科研模式",
        config: configFromForm(),
      }),
    });
    showMessage(`演示任务已提交：${data.job.id}`);
    loadJobs();
  } catch (error) {
    showMessage(`创建失败：${error.message}`, true);
  } finally {
    $("demoBtn").disabled = false;
    $("demoBtn").textContent = originalText;
  }
});

$("refreshBtn").addEventListener("click", loadJobs);
$("closeDialog").addEventListener("click", () => $("jobDialog").close());
$("jobDialog").addEventListener("click", (event) => {
  if (event.target === $("jobDialog")) $("jobDialog").close();
});

async function boot() {
  state.autoSync = readAutoSyncPreference();
  applyAutoSync(state.autoSync);
  setAuthMode("login");
  try {
    const data = await api("/api/me");
    showApp(data.user);
  } catch {
    showAuth();
  }
}

runBootSequence();
boot();

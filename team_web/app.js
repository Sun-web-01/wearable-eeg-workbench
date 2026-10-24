const $ = (id) => document.getElementById(id);

const state = {
  user: null,
  authMode: "login",
  jobs: [],
  selectedFile: null,
  pollTimer: null,
};

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
    : "创建个人账户，之后用同一账号查看团队数据和实验记录。";
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
  clearInterval(state.pollTimer);
  state.pollTimer = setInterval(loadJobs, 3500);
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

async function openJob(jobId) {
  const dialog = $("jobDialog");
  $("dialogTitle").textContent = "正在读取任务…";
  $("dialogContent").innerHTML = "";
  dialog.showModal();
  try {
    const data = await api(`/api/jobs/${jobId}`);
    const job = data.job;
    $("dialogTitle").textContent = job.title;
    const quality = job.quality_grade
      ? `${job.quality_grade} · ${qualityLabel(job.quality_grade)}`
      : "—";
    const downloads = job.has_report && job.status === "completed" ? `
      <div class="downloads">
        <a href="/api/jobs/${job.id}/view" target="_blank">查看质量报告</a>
        <a href="/api/jobs/${job.id}/download/report.json">报告数据 JSON</a>
        <a href="/api/jobs/${job.id}/download/features.csv">窗口特征 CSV</a>
        <a href="/api/jobs/${job.id}/download/processed.csv">处理后数据 CSV</a>
      </div>` : "";
    $("dialogContent").innerHTML = `
      <div class="detail-metrics">
        <div><span>任务状态</span><strong>${statusLabel(job.status)}</strong></div>
        <div><span>数据时长</span><strong>${job.duration_s ? `${Number(job.duration_s).toFixed(1)} 秒` : "—"}</strong></div>
        <div><span>信号质量</span><strong>${quality}</strong></div>
        <div><span>提交者</span><strong>${escapeHtml(job.owner_name)}</strong></div>
      </div>
      <p class="subline">输入文件：${escapeHtml(job.input_name || "系统演示数据")} · SHA-256 文件指纹：${escapeHtml(job.input_sha256 || "未记录")}</p>
      ${job.error ? `<div class="auth-error">${escapeHtml(job.error)}</div>` : ""}
      <h3>处理日志</h3>
      <div class="event-log">${data.events.map((event) => `<div>${escapeHtml(event.message)}<time>${formatTime(event.created_at)}</time></div>`).join("")}</div>
      ${downloads}`;
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
  setAuthMode("login");
  try {
    const data = await api("/api/me");
    showApp(data.user);
  } catch {
    showAuth();
  }
}

boot();

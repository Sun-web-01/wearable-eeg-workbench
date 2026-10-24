# 可穿戴 EEG/IMU 数据质量工作台

这是我在大创项目中负责的数据与信号工作台，用于 EEG/IMU 数据验收、基础预处理、运动伪迹筛查、窗口特征提取和报告导出。仓库同时包含可供全组共享的账号、任务队列、日志和报告平台。

当前结果适合流程联调和数据质量审查，不是论文最终算法。正式实验需安装研究依赖并使用 MNE/SciPy 的正式滤波、ICA 与抗混叠重采样。

## 快速开始

```powershell
.\scripts\setup.ps1 -Team
.\.venv\Scripts\python.exe -m pip install -e .
.\scripts\run_acceptance.ps1
.\scripts\start_team_platform.ps1
```

本机打开启动脚本显示的网址。组员在同一网络中使用“组内访问”地址注册并登录。共享平台部署见 [团队共享平台部署](docs/团队共享平台部署.md)。

### 通过 Tailscale 私有网络共享

不要让组员直接访问公网 IP。先让主机和组员加入同一个 Tailscale 私有网络，再启动：

```powershell
pwsh -File .\scripts\start_team_private.ps1
```

脚本会读取当前主机的 Tailscale IPv4 地址，并只在该地址上监听平台端口。组员只能通过 Tailscale 网络访问，不能从普通公网直接连接。组员首次注册仍需团队邀请码。

如果本机已有 Python 环境，也可以直接运行：

```powershell
python -m wearable_eeg demo --output reports/demo
python -m wearable_eeg serve --port 8000
python -m uvicorn team_platform.app:app --host 0.0.0.0 --port 8000
```

## 支持的输入

CSV 推荐列名：

```text
time_s,eeg_fpz,eeg_pz,acc_x_g,acc_y_g,acc_z_g,state_label
```

没有时间列时，在上传界面填入采样率。EDF 读取是可选能力，需要 `requirements-research.txt` 中的 MNE。

## 当前能力

- 自动识别 EEG/IMU 列；
- 时间轴排序、重复时间点处理、缺口检查；
- 线性重采样；
- 可配置带通与工频响应；
- 通道质量评分与综合等级；
- 三轴 IMU 运动伪迹门控；
- 4 秒窗/2 秒步长频带功率特征；
- JSON、HTML、特征 CSV、处理后 CSV 导出；
- 本地 Web 界面和 HTTP API；
- BrainFlow 蓝牙/串口设备扫描、原始数据采集和标准命名导出；
- 采集完成后一键进入 Research/EDF/CSV 分析流程；
- 演示数据与自动化测试。

## 关键目录

```text
wearable_eeg/              Python 处理包与本地 Web 服务
team_platform/             共享账号、任务队列和团队 API
team_web/                  团队协作界面
web/                       本地数据质量界面
tests/                     自动化验收
team_data/                 共享平台运行时数据（不提交 Git）
data/datasets.json         数据集登记与许可状态
data/raw/                  原始数据，默认不提交 Git
data/processed/            处理中间数据
reports/demo/              已生成的演示报告
docs/数据与信号执行手册.md  我的工作安排、协作方式和交付标准
docs/数据与实验规范.md     格式、泄露检查与匿名化
docs/上传校验与质量检查.md 上传预检、质量指标与公开项目调研
docs/设备采集说明.md        BrainFlow 设备连接、录制与文件命名
```

## 命令

```powershell
# 演示数据和报告
python -m wearable_eeg demo --output reports/demo

# 正式科研后端（需要 research 依赖）
python -m wearable_eeg demo --backend research --output reports/demo-research

# 处理 CSV
python -m wearable_eeg process data/raw/example.csv --output reports/runs/example

# 无时间列时
python -m wearable_eeg process data/raw/example.csv --sample-rate 128

# Sleep-EDF：附加 Hypnogram 睡眠分期
python -m wearable_eeg process data/raw/sleep_edf_expanded/SC4001E0-PSG.edf `
  --annotations data/raw/sleep_edf_expanded/SC4001EC-Hypnogram.edf `
  --backend research `
  --output reports/runs/sleep_edf_SC4001E0

# 自动化测试
python -m unittest discover -s tests -v
```

## 正式科研与团队环境

```powershell
.\scripts\setup.ps1 -Research
.\scripts\setup.ps1 -Team
```

研究依赖加入 SciPy、MNE、Matplotlib 和 scikit-learn。正式科研运行使用 `--backend research`，报告会记录 Python、NumPy、Pandas、SciPy 和 MNE 版本。论文结果还必须记录数据哈希、参数和随机种子，不能只保留最终截图。

## 团队协作与交付接口

完整团队产品由系统方向同学牵头，我提供数据接口，并与模型方向同学共同完成联调。我的主要交付物是 `process_dataframe()` 的 JSON 结果、`features.csv`、`processed.csv` 和标准化质量报告；实时设备接入后续通过 BrainFlow + LSL 共同完善。

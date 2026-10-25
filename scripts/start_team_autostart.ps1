param(
    [int]$Port = 8000,
    [int]$WaitSeconds = 180
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $root
$env:PYTHONUTF8 = "1"

$dataRoot = Join-Path $root "team_data"
New-Item -ItemType Directory -Force -Path $dataRoot | Out-Null
$logFile = Join-Path $dataRoot "autostart.log"

function Write-AutostartLog([string]$Message) {
    $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $Message"
    Add-Content -LiteralPath $logFile -Value $line -Encoding utf8
}

$listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($listener) {
    Write-AutostartLog "平台已在端口 $Port 运行，跳过重复启动。"
    exit 0
}

$tailscale = Get-Command tailscale -ErrorAction SilentlyContinue
$tailscalePath = if ($tailscale) {
    $tailscale.Source
} else {
    "C:\Program Files\Tailscale\tailscale.exe"
}
if (-not (Test-Path -LiteralPath $tailscalePath)) {
    Write-AutostartLog "启动失败：未找到 Tailscale。"
    throw "未找到 Tailscale。"
}

$deadline = (Get-Date).AddSeconds([Math]::Max(30, $WaitSeconds))
$tailscaleReady = $false
while ((Get-Date) -lt $deadline) {
    try {
        $status = & $tailscalePath status --json | ConvertFrom-Json
        if ($status.BackendState -eq "Running") {
            $tailscaleReady = $true
            break
        }
    } catch {
        # Tailscale may still be starting after logon.
    }
    Start-Sleep -Seconds 5
}

if (-not $tailscaleReady) {
    Write-AutostartLog "启动失败：等待 Tailscale 超时。"
    throw "等待 Tailscale 启动超时。"
}

Write-AutostartLog "检测到 Tailscale 已就绪，开始启动 NeuroTeam。"
& (Join-Path $PSScriptRoot "start_team_private.ps1") -Port $Port

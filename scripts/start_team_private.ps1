param(
    [int]$Port = 8000
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $root
$env:PYTHONUTF8 = "1"

$python = Join-Path $root ".venv\Scripts\python.exe"
if (-not (Test-Path -LiteralPath $python)) {
    throw "团队平台环境不存在。先运行 .\scripts\setup.ps1 -Team。"
}

$tailscale = Get-Command tailscale -ErrorAction SilentlyContinue
if (-not $tailscale) {
    $candidate = "C:\Program Files\Tailscale\tailscale.exe"
    if (-not (Test-Path -LiteralPath $candidate)) {
        throw "未找到 Tailscale。请先安装并登录 Tailscale。"
    }
    $tailscalePath = $candidate
} else {
    $tailscalePath = $tailscale.Source
}

$status = & $tailscalePath status --json | ConvertFrom-Json
if ($status.BackendState -ne "Running") {
    throw "Tailscale 尚未登录或未运行。先执行 tailscale up 并完成登录。"
}

$privateIp = $status.Self.TailscaleIPs |
    Where-Object { $_ -match "^\d+\.\d+\.\d+\.\d+$" } |
    Select-Object -First 1
if (-not $privateIp) {
    throw "没有读取到 Tailscale IPv4 地址。"
}

$dataRoot = Join-Path $root "team_data"
New-Item -ItemType Directory -Force -Path $dataRoot | Out-Null

$inviteFile = Join-Path $dataRoot ".invite_code"
if (-not $env:EEG_INVITE_CODE) {
    if (-not (Test-Path -LiteralPath $inviteFile)) {
        $bytes = New-Object byte[] 6
        [Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
        [Convert]::ToHexString($bytes).ToLowerInvariant() |
            Set-Content -LiteralPath $inviteFile -Encoding utf8
    }
    $env:EEG_INVITE_CODE = (Get-Content -Raw -LiteralPath $inviteFile).Trim()
}

$secretFile = Join-Path $dataRoot ".cookie_secret"
if (-not $env:EEG_COOKIE_SECRET) {
    if (-not (Test-Path -LiteralPath $secretFile)) {
        $bytes = New-Object byte[] 32
        [Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
        [Convert]::ToHexString($bytes).ToLowerInvariant() |
            Set-Content -LiteralPath $secretFile -Encoding utf8
    }
    $env:EEG_COOKIE_SECRET = (Get-Content -Raw -LiteralPath $secretFile).Trim()
}

$env:EEG_DATA_DIR = $dataRoot
$env:EEG_HOST = $privateIp
$env:EEG_PORT = "$Port"

Write-Host ""
Write-Host "NeuroTeam 私有团队平台"
Write-Host "Tailscale 私有访问: http://$privateIp`:$Port"
Write-Host "仅同一 Tailscale 私有网络中的设备可以访问。"
Write-Host "按 Ctrl+C 停止。"
Write-Host ""

& $python -m uvicorn team_platform.app:app --host $privateIp --port $Port

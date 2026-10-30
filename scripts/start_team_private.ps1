param(
    [int]$Port = 8000
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $root
$env:PYTHONUTF8 = "1"

function Test-TailscaleIPv4([string]$Address) {
    $parts = $Address.Split(".")
    return $parts.Count -eq 4 -and
        $parts[0] -eq "100" -and
        [int]$parts[1] -ge 64 -and
        [int]$parts[1] -le 127
}

function Get-TailscaleIPv4([string]$TailscalePath) {
    try {
        $address = & $TailscalePath ip -4 2>$null | Select-Object -First 1
        if ($address -and (Test-TailscaleIPv4 $address.Trim())) {
            return $address.Trim()
        }
    } catch {
        # Fall back to local interface discovery.
    }

    try {
        $status = & $TailscalePath status --json 2>$null | ConvertFrom-Json
        if ($status.BackendState -eq "Running") {
            $address = $status.Self.TailscaleIPs |
                Where-Object { Test-TailscaleIPv4 $_ } |
                Select-Object -First 1
            if ($address) {
                return $address
            }
        }
    } catch {
        # The service pipe may be unavailable in a restricted user session.
    }

    $address = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
        Where-Object {
            $_.InterfaceAlias -eq "Tailscale" -and
            $_.AddressState -eq "Preferred" -and
            (Test-TailscaleIPv4 $_.IPAddress)
        } |
        Select-Object -ExpandProperty IPAddress -First 1
    return $address
}

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

$privateIp = Get-TailscaleIPv4 -TailscalePath $tailscalePath
if (-not $privateIp) {
    throw "Tailscale 尚未登录或未运行，也没有找到 100.64.0.0/10 地址。"
}

try {
    $health = Invoke-WebRequest -UseBasicParsing -Uri "http://$privateIp`:$Port/api/health" -TimeoutSec 3
    $healthBody = $health.Content | ConvertFrom-Json
    if ($health.StatusCode -eq 200 -and $healthBody.status -eq "ok") {
        Write-Host "NeuroTeam 已在 http://$privateIp`:$Port 正常运行。"
        exit 0
    }
} catch {
    # The platform is not responding yet.
}

$existing = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
$matchingListener = $existing | Where-Object { $_.LocalAddress -eq $privateIp }
if ($matchingListener) {
    throw "端口 $Port 已被占用，但健康检查失败。请等待守护进程清理后重试。"
}
if ($existing) {
    $addresses = ($existing | Select-Object -ExpandProperty LocalAddress -Unique) -join ", "
    throw "端口 $Port 被错误地址占用：$addresses。预期地址为 $privateIp。"
}

$dataRoot = Join-Path $root "team_data"
New-Item -ItemType Directory -Force -Path $dataRoot | Out-Null

$inviteFile = Join-Path $dataRoot ".invite_code"
if (-not $env:EEG_INVITE_CODE) {
    if (-not (Test-Path -LiteralPath $inviteFile)) {
        $bytes = New-Object byte[] 6
        [Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
        (($bytes | ForEach-Object { $_.ToString("x2") }) -join "") |
            Set-Content -LiteralPath $inviteFile -Encoding utf8
    }
    $env:EEG_INVITE_CODE = (Get-Content -Raw -LiteralPath $inviteFile).Trim()
}

$secretFile = Join-Path $dataRoot ".cookie_secret"
if (-not $env:EEG_COOKIE_SECRET) {
    if (-not (Test-Path -LiteralPath $secretFile)) {
        $bytes = New-Object byte[] 32
        [Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
        (($bytes | ForEach-Object { $_.ToString("x2") }) -join "") |
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

param(
    [int]$Port = 8000
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $root
$env:PYTHONUTF8 = "1"

$existing = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($existing) {
    Write-Host "NeuroTeam 已在端口 $Port 运行，无需重复启动。"
    exit 0
}

$python = Join-Path $root ".venv\Scripts\python.exe"
if (-not (Test-Path -LiteralPath $python)) {
    throw "团队平台环境不存在。先运行 .\scripts\setup.ps1 -Research，再安装 requirements-team.txt。"
}

$dataRoot = Join-Path $root "team_data"
New-Item -ItemType Directory -Force -Path $dataRoot | Out-Null

$inviteFile = Join-Path $dataRoot ".invite_code"
if (-not $env:EEG_INVITE_CODE) {
    if (Test-Path -LiteralPath $inviteFile) {
        $env:EEG_INVITE_CODE = (Get-Content -Raw -LiteralPath $inviteFile).Trim()
    } else {
        $bytes = New-Object byte[] 6
        [Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
        $env:EEG_INVITE_CODE = ($bytes | ForEach-Object { $_.ToString("x2") }) -join ""
        Set-Content -LiteralPath $inviteFile -Value $env:EEG_INVITE_CODE -Encoding utf8
    }
}

$secretFile = Join-Path $dataRoot ".cookie_secret"
if (-not $env:EEG_COOKIE_SECRET) {
    if (Test-Path -LiteralPath $secretFile) {
        $env:EEG_COOKIE_SECRET = (Get-Content -Raw -LiteralPath $secretFile).Trim()
    } else {
        $bytes = New-Object byte[] 32
        [Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
    $env:EEG_COOKIE_SECRET = ($bytes | ForEach-Object { $_.ToString("x2") }) -join ""
        Set-Content -LiteralPath $secretFile -Value $env:EEG_COOKIE_SECRET -Encoding utf8
    }
}

$env:EEG_DATA_DIR = $dataRoot
$env:EEG_HOST = "0.0.0.0"
$env:EEG_PORT = "$Port"

Write-Host ""
Write-Host "NeuroTeam 团队平台"
Write-Host "本机访问: http://127.0.0.1:$Port"
$addresses = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -notlike "127.*" -and $_.AddressState -eq "Preferred" }
foreach ($address in $addresses) {
    Write-Host "组内访问: http://$($address.IPAddress):$Port"
}
Write-Host "团队邀请码: $env:EEG_INVITE_CODE"
Write-Host "数据目录: $dataRoot"
Write-Host "按 Ctrl+C 停止。"
Write-Host ""

& $python -m uvicorn team_platform.app:app --host 0.0.0.0 --port $Port


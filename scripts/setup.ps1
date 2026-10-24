param(
    [switch]$Research,
    [switch]$Team
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $root

$pythonCommand = Get-Command python -ErrorAction SilentlyContinue
if (-not $pythonCommand) {
    throw "未找到 python 命令。请安装 Python 3.11+，或在本机已有虚拟环境中运行。"
}

if (-not (Test-Path -LiteralPath ".venv")) {
    & $pythonCommand.Source -m venv .venv
}

$venvPython = Join-Path $root ".venv\Scripts\python.exe"
& $venvPython -m pip install --upgrade pip
$requirements = if ($Team) { "requirements-team.txt" } elseif ($Research) { "requirements-research.txt" } else { "requirements.txt" }
& $venvPython -m pip install -r $requirements
& $venvPython -m pip install -e .

Write-Host "环境已就绪：$venvPython"
Write-Host "启动平台：.\scripts\run_platform.ps1"


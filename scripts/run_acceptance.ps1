$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $root
$env:PYTHONUTF8 = "1"

$venvPython = Join-Path $root ".venv\Scripts\python.exe"
if (Test-Path -LiteralPath $venvPython) {
    $python = $venvPython
} else {
    $pythonCommand = Get-Command python -ErrorAction SilentlyContinue
    if (-not $pythonCommand) {
        throw "未找到 Python。先运行 .\scripts\setup.ps1。"
    }
    $python = $pythonCommand.Source
}

& $python -m unittest discover -s tests -v
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$outputDirectory = Join-Path $root "reports\runs\acceptance-$stamp"
& $python -m wearable_eeg demo --output $outputDirectory

Write-Host "验收完成：$outputDirectory\report.html"


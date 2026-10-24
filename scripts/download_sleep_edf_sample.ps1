param(
    [string]$Record = "SC4001E0"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$destination = Join-Path $root "data\raw\sleep_edf_expanded"
New-Item -ItemType Directory -Force -Path $destination | Out-Null

$base = "https://physionet.org/files/sleep-edfx/1.0.0/sleep-cassette"
$psgName = "$Record-PSG.edf"
$annotationName = "$($Record.Substring(0, 6))EC-Hypnogram.edf"

Write-Host "下载 $psgName 与 $annotationName"
curl.exe -L --fail --retry 3 "$base/$psgName" -o (Join-Path $destination $psgName)
curl.exe -L --fail --retry 3 "$base/$annotationName" -o (Join-Path $destination $annotationName)

Get-FileHash -Algorithm SHA256 (Join-Path $destination $psgName), (Join-Path $destination $annotationName) |
    Format-Table -AutoSize

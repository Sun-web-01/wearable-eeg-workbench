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

    return Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
        Where-Object {
            $_.InterfaceAlias -eq "Tailscale" -and
            $_.AddressState -eq "Preferred" -and
            (Test-TailscaleIPv4 $_.IPAddress)
        } |
        Select-Object -ExpandProperty IPAddress -First 1
}

function Test-TeamPlatformHealth([string]$PrivateIp) {
    try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri "http://$PrivateIp`:$Port/api/health" -TimeoutSec 3
        if ($response.StatusCode -ne 200) {
            return $false
        }
        $health = $response.Content | ConvertFrom-Json
        return $health.status -eq "ok"
    } catch {
        return $false
    }
}

function Stop-ProcessTree([int]$RootProcessId) {
    $children = Get-CimInstance Win32_Process -Filter "ParentProcessId=$RootProcessId" -ErrorAction SilentlyContinue
    foreach ($child in $children) {
        Stop-ProcessTree -RootProcessId $child.ProcessId
    }
    Stop-Process -Id $RootProcessId -ErrorAction SilentlyContinue
}

function Stop-TeamPlatformProcesses([object[]]$Listeners) {
    foreach ($listener in $Listeners) {
        $process = Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)" -ErrorAction SilentlyContinue
        if ($process.CommandLine -match "uvicorn\s+team_platform\.app:app") {
            Stop-ProcessTree -RootProcessId $listener.OwningProcess
            Write-AutostartLog "已停止异常 NeuroTeam 进程，监听地址 $($listener.LocalAddress)。"
        } else {
            Write-AutostartLog "端口 $Port 被其他程序占用，地址为 $($listener.LocalAddress)。"
        }
    }
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

Write-AutostartLog "自动启动守护进程已开始运行。"
$lastState = ""
$managedProcess = $null
$managedStartedAt = $null
while ($true) {
    $privateIp = Get-TailscaleIPv4 -TailscalePath $tailscalePath
    if (-not $privateIp) {
        if ($lastState -ne "waiting") {
            Write-AutostartLog "等待 Tailscale 100.64.0.0/10 地址。"
            $lastState = "waiting"
        }
        Start-Sleep -Seconds 5
        continue
    }

    $listeners = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
    if (Test-TeamPlatformHealth $privateIp) {
        if ($lastState -ne "healthy") {
            Write-AutostartLog "平台健康：http://$privateIp`:$Port"
            $lastState = "healthy"
        }
        Start-Sleep -Seconds 10
        continue
    }

    if ($managedProcess -and $managedProcess.HasExited) {
        Write-AutostartLog "受管服务进程已退出。"
        $managedProcess = $null
        $managedStartedAt = $null
    }

    if ($managedProcess -and -not $managedProcess.HasExited) {
        $startupAge = ((Get-Date) - $managedStartedAt).TotalSeconds
        if ($startupAge -lt 30) {
            Start-Sleep -Seconds 5
            continue
        }
        Stop-ProcessTree -RootProcessId $managedProcess.Id
        Write-AutostartLog "平台健康检查失败，重启受管服务进程。"
        $managedProcess = $null
        $managedStartedAt = $null
        Start-Sleep -Seconds 2
        $listeners = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
    }

    if ($listeners) {
        Stop-TeamPlatformProcesses -Listeners $listeners
        Start-Sleep -Seconds 3
        $remaining = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
        if ($remaining) {
            $lastState = "port-conflict"
            Start-Sleep -Seconds 10
            continue
        }
    }

    $lastState = "starting"
    Write-AutostartLog "检测到 Tailscale 地址 $privateIp，开始启动 NeuroTeam。"
    $currentPowerShell = (Get-Process -Id $PID).Path
    $startArguments = "-NoProfile -ExecutionPolicy Bypass -File `"$(Join-Path $PSScriptRoot 'start_team_private.ps1')`" -Port $Port"
    $managedProcess = Start-Process -FilePath $currentPowerShell -ArgumentList $startArguments -WorkingDirectory $root -WindowStyle Hidden -PassThru
    $managedStartedAt = Get-Date
    Start-Sleep -Seconds 5
}

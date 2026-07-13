param(
  [Parameter(Mandatory = $true)]
  [string]$Root
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$root = (Resolve-Path -LiteralPath $Root).Path
$varDir = Join-Path $root "var"
$logDir = Join-Path $varDir "logs"
$statePath = Join-Path $varDir "grimoire-host.json"
$venvPy = Join-Path $root "vendor\ComfyUI\venv\Scripts\python.exe"
$node = (Get-Command node.exe -ErrorAction Stop).Source
$ollama = (Get-Command ollama.exe -ErrorAction Stop).Source
$token = [Guid]::NewGuid().ToString("N")
$env:GRIMOIRE_SHUTDOWN_TOKEN = $token
$env:GRIMOIRE_IDLE_SHUTDOWN_MS = "15000"
$managed = New-Object System.Collections.ArrayList

New-Item -ItemType Directory -Force -Path $logDir | Out-Null

function Test-Http([string]$Url) {
  try {
    Invoke-RestMethod -Uri $Url -TimeoutSec 2 | Out-Null
    return $true
  } catch {
    return $false
  }
}

function Wait-Http([string]$Name, [string]$Url, [int]$Seconds) {
  for ($i = 0; $i -lt $Seconds; $i++) {
    if (Test-Http $Url) { return $true }
    Start-Sleep -Seconds 1
  }
  Write-Warning "$Name did not become ready; continuing in degraded mode"
  return $false
}

function Get-PortProcessId([int]$Port) {
  $listener = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue |
    Select-Object -First 1
  if ($listener) { return [int]$listener.OwningProcess }
  return $null
}

function Add-Managed([string]$Name, [int]$ProcessId) {
  if ($managed | Where-Object { $_.ProcessId -eq $ProcessId }) { return }
  $managed.Add([pscustomobject]@{ Name = $Name; ProcessId = $ProcessId }) | Out-Null
}

function Save-State {
  $state = [ordered]@{
    supervisorPid = $PID
    startedAt = (Get-Date).ToString("o")
    shutdownToken = $token
    processes = @($managed | ForEach-Object {
      [ordered]@{ name = $_.Name; processId = $_.ProcessId }
    })
  }
  $state | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $statePath -Encoding UTF8
}

function Start-ManagedService(
  [string]$Name,
  [string]$HealthUrl,
  [int]$Port,
  [string]$FilePath,
  [string[]]$Arguments,
  [bool]$AdoptRepoProcess = $true
) {
  if (Test-Http $HealthUrl) {
    $existingPid = Get-PortProcessId $Port
    if ($existingPid -and $AdoptRepoProcess) {
      $existing = Get-CimInstance Win32_Process -Filter "ProcessId = $existingPid" -ErrorAction SilentlyContinue
      if ($existing -and $existing.CommandLine -like "*$root*") {
        Add-Managed $Name $existingPid
        Write-Output "[ADOPT] $Name (PID $existingPid)"
      } else {
        Write-Output "[KEEP]  $Name was already running outside Grimoire"
      }
    } else {
      Write-Output "[KEEP]  $Name was already running outside Grimoire"
    }
    return
  }

  $safeName = $Name.ToLowerInvariant().Replace(" ", "-")
  $stdout = Join-Path $logDir "$safeName.log"
  $stderr = Join-Path $logDir "$safeName.error.log"
  $process = Start-Process -FilePath $FilePath -ArgumentList $Arguments -WorkingDirectory $root `
    -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
  Add-Managed $Name $process.Id
  Save-State
  Write-Output "[BOOT]  $Name (PID $($process.Id))"
}

function Stop-ProcessTree([int]$ProcessId) {
  if (-not (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)) { return }
  & taskkill.exe /PID $ProcessId /T /F 2>$null | Out-Null
}

try {
  Save-State

  Start-ManagedService "Ollama" "http://127.0.0.1:11434/api/tags" 11434 `
    $ollama @("serve") $false
  Start-ManagedService "ComfyUI" "http://127.0.0.1:8188/system_stats" 8188 `
    $venvPy @((Join-Path $root "vendor\ComfyUI\main.py"), "--port", "8188", "--disable-auto-launch")
  Wait-Http "ComfyUI" "http://127.0.0.1:8188/system_stats" 30 | Out-Null
  Start-ManagedService "Narrator" "http://127.0.0.1:7861/health" 7861 `
    $venvPy @((Join-Path $root "tools\tts-sidecar\server.py"))
  Wait-Http "Narrator" "http://127.0.0.1:7861/health" 30 | Out-Null
  Start-ManagedService "Game server" "http://127.0.0.1:7777/health" 7777 `
    $node @((Join-Path $root "node_modules\tsx\dist\cli.mjs"), (Join-Path $root "packages\server\src\index.ts"))
  Start-ManagedService "Web client" "http://127.0.0.1:5173" 5173 `
    $node @((Join-Path $root "node_modules\vite\bin\vite.js"), (Join-Path $root "packages\client"), "--host")

  Save-State

  $ready = $false
  for ($i = 0; $i -lt 120 -and -not $ready; $i++) {
    $ready = (Test-Http "http://127.0.0.1:7777/health") -and (Test-Http "http://127.0.0.1:5173")
    if (-not $ready) { Start-Sleep -Seconds 1 }
  }
  if (-not $ready) { throw "Game server or web client did not become ready." }

  Write-Output "[READY] Grimoire is running in the background"
  while (Test-Http "http://127.0.0.1:7777/health") {
    Start-Sleep -Seconds 2
  }
} catch {
  Write-Error $_
} finally {
  Write-Output "[STOP]  Cleaning up Grimoire services"
  $items = @($managed)
  [array]::Reverse($items)
  foreach ($item in $items) { Stop-ProcessTree $item.ProcessId }

  if (Test-Path $statePath) {
    try {
      $state = Get-Content -Raw $statePath | ConvertFrom-Json
      if ($state.supervisorPid -eq $PID) { Remove-Item -LiteralPath $statePath -Force }
    } catch {
      Remove-Item -LiteralPath $statePath -Force -ErrorAction SilentlyContinue
    }
  }
}

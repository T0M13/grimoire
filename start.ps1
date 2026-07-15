# Grimoire — one-command launcher for the host.
# Starts: Ollama (if not running) + ComfyUI + Kokoro TTS + game server + web client.
# Play at http://localhost:8786  (friends on your LAN/Tailscale: http://<your-ip>:8786)

param([switch]$Persistent)

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$setup = Join-Path $root "setup.ps1"
$supervisor = Join-Path $root "tools\host\supervisor.mjs"
$statePath = Join-Path $root "var\grimoire-host.json"
$logDir = Join-Path $root "var\logs"
$gamePort = if ($env:GRIMOIRE_GAME_PORT) { [int]$env:GRIMOIRE_GAME_PORT } else { 8787 }
$webPort = if ($env:GRIMOIRE_WEB_PORT) { [int]$env:GRIMOIRE_WEB_PORT } else { 8786 }
$bindHost = if ($env:GRIMOIRE_BIND_HOST) { $env:GRIMOIRE_BIND_HOST } else { "0.0.0.0" }
$probeHost = if ($bindHost -eq "0.0.0.0") {
  "127.0.0.1"
} elseif ($bindHost -eq "::") {
  "[::1]"
} elseif ($bindHost.Contains(':')) {
  "[$bindHost]"
} else {
  $bindHost
}

# Existing terminals do not notice environment variables saved at User scope after they opened.
# Refresh the public origin here so `npm start` works immediately without storing host/domain
# configuration in the repository. An explicit process value still wins.
if (-not $env:GRIMOIRE_PUBLIC_ORIGIN) {
  $savedPublicOrigin = [Environment]::GetEnvironmentVariable("GRIMOIRE_PUBLIC_ORIGIN", "User")
  if ($savedPublicOrigin) { $env:GRIMOIRE_PUBLIC_ORIGIN = $savedPublicOrigin }
}
$playUrl = if ($env:GRIMOIRE_PUBLIC_ORIGIN) {
  $env:GRIMOIRE_PUBLIC_ORIGIN.TrimEnd('/')
} else {
  "http://localhost:$webPort"
}

if (Test-Path $statePath) {
  try {
    $state = Get-Content -Raw $statePath | ConvertFrom-Json
    if (Get-Process -Id $state.supervisorPid -ErrorAction SilentlyContinue) {
      $runningPlayUrl = $playUrl
      if (-not $env:GRIMOIRE_PUBLIC_ORIGIN -and $state.webPort) {
        $runningPlayUrl = "http://localhost:$($state.webPort)"
      }
      Write-Host "Grimoire is already running in the background." -ForegroundColor Green
      Write-Host "Play at $runningPlayUrl" -ForegroundColor Cyan
      exit 0
    }
  } catch { }
  Remove-Item -LiteralPath $statePath -Force -ErrorAction SilentlyContinue
}

# A fresh clone has only source code. Bootstrap local runtimes, packages, and model files.
try {
  & $setup
} catch {
  Write-Host ""
  Write-Host "Setup failed: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host "Fix the issue above, then run .\start.ps1 again." -ForegroundColor Yellow
  exit 1
}

Write-Host ""
Write-Host "  GRIMOIRE" -ForegroundColor DarkYellow
Write-Host "  --------" -ForegroundColor DarkYellow

New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$supervisorOut = Join-Path $logDir "supervisor.log"
$supervisorErr = Join-Path $logDir "supervisor.error.log"
$node = (Get-Command node.exe -ErrorAction Stop).Source
$previousAutoShutdown = $env:GRIMOIRE_AUTO_SHUTDOWN
try {
  if ($Persistent) { $env:GRIMOIRE_AUTO_SHUTDOWN = "0" }
  else { Remove-Item Env:GRIMOIRE_AUTO_SHUTDOWN -ErrorAction SilentlyContinue }
  $hostProcess = Start-Process $node `
    -ArgumentList @("`"$supervisor`"", "`"$root`"") `
    -WindowStyle Hidden -RedirectStandardOutput $supervisorOut -RedirectStandardError $supervisorErr -PassThru
} finally {
  if ($null -eq $previousAutoShutdown) { Remove-Item Env:GRIMOIRE_AUTO_SHUTDOWN -ErrorAction SilentlyContinue }
  else { $env:GRIMOIRE_AUTO_SHUTDOWN = $previousAutoShutdown }
}

$ready = $false
for ($i = 0; $i -lt 120 -and -not $ready; $i++) {
  try {
    Invoke-RestMethod -Uri "http://${probeHost}:$gamePort/health" -TimeoutSec 2 | Out-Null
    $webResponse = Invoke-WebRequest -UseBasicParsing -Uri "http://${probeHost}:$webPort" -TimeoutSec 2
    if ($webResponse.Content -notlike '*<title>Grimoire</title>*') {
      throw "Port $webPort is responding, but it is not the Grimoire web client."
    }
    $ready = $true
  } catch {
    if ($hostProcess.HasExited) { break }
    Start-Sleep -Seconds 1
  }
}

if (-not $ready) {
  Write-Host "Background host failed to start. See var\logs\supervisor.error.log" -ForegroundColor Red
  if (Test-Path $supervisorErr) { Get-Content $supervisorErr -Tail 10 }
  exit 1
}

Write-Host ""
Write-Host "  Running quietly in the background: $playUrl" -ForegroundColor Cyan
if ($Persistent) {
  Write-Host "  Persistent mode is enabled; use .\stop.ps1 to stop the stack." -ForegroundColor DarkGray
} else {
  Write-Host "  Closing the final browser tab stops the stack after 15 seconds." -ForegroundColor DarkGray
}
Write-Host "  Manual stop: .\stop.ps1   Logs: var\logs\" -ForegroundColor DarkGray
Write-Host "  Reset the campaign: delete var\grimoire.db" -ForegroundColor DarkGray
Write-Host ""

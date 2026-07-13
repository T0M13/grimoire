# Grimoire — one-command launcher for the host.
# Starts: Ollama (if not running) + ComfyUI + Kokoro TTS + game server + web client.
# Play at http://localhost:5173  (friends on your LAN/Tailscale: http://<your-ip>:5173)

param([switch]$Persistent)

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$setup = Join-Path $root "setup.ps1"
$supervisor = Join-Path $root "tools\host\supervisor.mjs"
$statePath = Join-Path $root "var\grimoire-host.json"
$logDir = Join-Path $root "var\logs"
$gamePort = if ($env:GRIMOIRE_GAME_PORT) { [int]$env:GRIMOIRE_GAME_PORT } else { 8787 }

if (Test-Path $statePath) {
  try {
    $state = Get-Content -Raw $statePath | ConvertFrom-Json
    if (Get-Process -Id $state.supervisorPid -ErrorAction SilentlyContinue) {
      Write-Host "Grimoire is already running in the background." -ForegroundColor Green
      Write-Host "Play at http://localhost:5173" -ForegroundColor Cyan
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
    Invoke-RestMethod -Uri "http://127.0.0.1:$gamePort/health" -TimeoutSec 2 | Out-Null
    Invoke-RestMethod -Uri "http://127.0.0.1:5173" -TimeoutSec 2 | Out-Null
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
Write-Host "  Running quietly in the background: http://localhost:5173" -ForegroundColor Cyan
if ($Persistent) {
  Write-Host "  Persistent mode is enabled; use .\stop.ps1 to stop the stack." -ForegroundColor DarkGray
} else {
  Write-Host "  Closing the final browser tab stops the stack after 15 seconds." -ForegroundColor DarkGray
}
Write-Host "  Manual stop: .\stop.ps1   Logs: var\logs\" -ForegroundColor DarkGray
Write-Host "  Reset the campaign: delete var\grimoire.db" -ForegroundColor DarkGray
Write-Host ""

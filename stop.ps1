# Gracefully stop the hidden Grimoire host and every process it owns.
$ErrorActionPreference = "SilentlyContinue"
$root = $PSScriptRoot
$statePath = Join-Path $root "var\grimoire-host.json"

if (-not (Test-Path $statePath)) {
  Write-Host "Grimoire is not running under the background host." -ForegroundColor DarkGray
  exit 0
}

$state = Get-Content -Raw $statePath | ConvertFrom-Json
Write-Host "Stopping Grimoire..." -ForegroundColor Yellow

try {
  Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:7777/shutdown" -TimeoutSec 3 `
    -Headers @{ "x-grimoire-token" = $state.shutdownToken } | Out-Null
} catch {
  # The server may already be down; the process-tree fallback below still cleans everything.
}

for ($i = 0; $i -lt 15 -and (Get-Process -Id $state.supervisorPid -ErrorAction SilentlyContinue); $i++) {
  Start-Sleep -Seconds 1
}

if (Get-Process -Id $state.supervisorPid -ErrorAction SilentlyContinue) {
  $processes = @($state.processes)
  [array]::Reverse($processes)
  foreach ($process in $processes) {
    & taskkill.exe /PID $process.processId /T /F 2>$null | Out-Null
  }
  & taskkill.exe /PID $state.supervisorPid /T /F 2>$null | Out-Null
}

Remove-Item -LiteralPath $statePath -Force -ErrorAction SilentlyContinue
Write-Host "Grimoire stopped." -ForegroundColor Green

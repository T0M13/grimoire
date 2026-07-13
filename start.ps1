# Grimoire — one-command launcher for the host.
# Starts: Ollama (if not running) + ComfyUI + Kokoro TTS + game server + web client.
# Play at http://localhost:5173  (friends on your LAN/Tailscale: http://<your-ip>:5173)

$root = $PSScriptRoot
$setup = Join-Path $root "setup.ps1"

# A fresh clone has only source code. Bootstrap local runtimes, packages, and model files.
try {
  & $setup
} catch {
  Write-Host ""
  Write-Host "Setup failed: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host "Fix the issue above, then run .\start.ps1 again." -ForegroundColor Yellow
  exit 1
}

$venvPy = Join-Path $root "vendor\ComfyUI\venv\Scripts\python.exe"

function Start-IfDown($name, $url, $script) {
  try {
    Invoke-RestMethod -Uri $url -TimeoutSec 2 | Out-Null
    Write-Host "[OK]   $name already running" -ForegroundColor Green
  } catch {
    Write-Host "[BOOT] $name..." -ForegroundColor Yellow
    Start-Process powershell -ArgumentList "-NoExit", "-Command", $script -WindowStyle Minimized
  }
}

Write-Host ""
Write-Host "  GRIMOIRE" -ForegroundColor DarkYellow
Write-Host "  --------" -ForegroundColor DarkYellow

# Ollama usually runs as a service; poke it so the model can preload
Start-IfDown "Ollama"      "http://127.0.0.1:11434/api/tags"   "ollama serve"
Start-IfDown "ComfyUI"     "http://127.0.0.1:8188/system_stats" "& '$venvPy' '$root\vendor\ComfyUI\main.py' --port 8188 --disable-auto-launch"
Start-IfDown "Narrator"    "http://127.0.0.1:7861/health"       "& '$venvPy' '$root\tools\tts-sidecar\server.py'"
Start-IfDown "Game server" "http://127.0.0.1:7777/health"       "Set-Location '$root'; npm run dev:server"
Start-IfDown "Web client"  "http://127.0.0.1:5173"              "Set-Location '$root'; npm run dev:client"

Write-Host ""
Write-Host "  When all windows are up: play at http://localhost:5173" -ForegroundColor Cyan
Write-Host "  Reset the campaign: delete var\grimoire.db" -ForegroundColor DarkGray
Write-Host ""

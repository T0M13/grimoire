# Grimoire first-run bootstrap for Windows.
# Safe to run repeatedly: every expensive step is skipped when already satisfied.
[CmdletBinding()]
param(
  [switch]$Check
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$root = $PSScriptRoot
$stateDir = Join-Path $root "var\setup"
$comfyDir = Join-Path $root "vendor\ComfyUI"
$comfyCommit = "917faef771a2fd2f14f44af94f17da3d0b2803a3"

function Refresh-ProcessPath {
  $machine = [Environment]::GetEnvironmentVariable("Path", "Machine")
  $user = [Environment]::GetEnvironmentVariable("Path", "User")
  $env:Path = "$machine;$user"
}

function Resolve-Executable([string]$Name, [string[]]$Fallbacks) {
  $cmd = Get-Command $Name -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  foreach ($candidate in $Fallbacks) {
    $expanded = [Environment]::ExpandEnvironmentVariables($candidate)
    if (Test-Path -LiteralPath $expanded) { return $expanded }
  }
  return $null
}

function Install-Package([string]$Id, [string]$Label) {
  if ($Check) {
    Write-Host "[MISS] $Label (run .\setup.ps1 to install it)" -ForegroundColor Yellow
    return
  }
  $winget = Resolve-Executable "winget.exe" @("%LOCALAPPDATA%\Microsoft\WindowsApps\winget.exe")
  if (-not $winget) {
    throw "$Label is missing and winget is unavailable. Install $Label, then rerun .\start.ps1."
  }
  Write-Host "[GET]  Installing $Label..." -ForegroundColor Yellow
  & $winget install --id $Id --exact --silent --accept-package-agreements --accept-source-agreements | Out-Host
  if ($LASTEXITCODE -ne 0) { throw "winget could not install $Label (exit $LASTEXITCODE)." }
  Refresh-ProcessPath
}

function Ensure-Executable([string]$Name, [string]$PackageId, [string]$Label, [string[]]$Fallbacks) {
  $exe = Resolve-Executable $Name $Fallbacks
  if (-not $exe) {
    Install-Package $PackageId $Label
    $exe = Resolve-Executable $Name $Fallbacks
  }
  if (-not $exe -and -not $Check) {
    throw "$Label was installed but is not visible yet. Open a new PowerShell window and rerun .\start.ps1."
  }
  return $exe
}

function Test-Http([string]$Url) {
  try {
    Invoke-RestMethod -Uri $Url -TimeoutSec 2 | Out-Null
    return $true
  } catch {
    return $false
  }
}

function Ensure-Download(
  [string]$Label,
  [string]$Url,
  [string]$Destination,
  [long]$MinimumBytes,
  [string]$ExpectedSha256
) {
  if ((Test-Path -LiteralPath $Destination) -and (Get-Item -LiteralPath $Destination).Length -ge $MinimumBytes) {
    Write-Host "[OK]   $Label" -ForegroundColor Green
    return
  }
  if ($Check) {
    Write-Host "[MISS] $Label" -ForegroundColor Yellow
    return
  }

  $parent = Split-Path -Parent $Destination
  New-Item -ItemType Directory -Force -Path $parent | Out-Null
  $temp = "$Destination.download"
  Remove-Item -LiteralPath $temp -Force -ErrorAction SilentlyContinue
  Write-Host "[GET]  $Label (large one-time download)..." -ForegroundColor Yellow
  $curl = Resolve-Executable "curl.exe" @("%WINDIR%\System32\curl.exe")
  if (-not $curl) { throw "curl.exe is required to download $Label." }
  & $curl --location --fail --retry 3 --output $temp $Url
  if ($LASTEXITCODE -ne 0) {
    Remove-Item -LiteralPath $temp -Force -ErrorAction SilentlyContinue
    throw "Download failed: $Label"
  }
  if ((Get-Item -LiteralPath $temp).Length -lt $MinimumBytes) {
    Remove-Item -LiteralPath $temp -Force
    throw "Downloaded file is unexpectedly small: $Label"
  }
  $actualHash = (Get-FileHash -LiteralPath $temp -Algorithm SHA256).Hash
  if ($actualHash -ne $ExpectedSha256) {
    Remove-Item -LiteralPath $temp -Force
    throw "Checksum verification failed: $Label"
  }
  Move-Item -LiteralPath $temp -Destination $Destination -Force
}

Write-Host ""
Write-Host "  GRIMOIRE SETUP" -ForegroundColor DarkYellow
Write-Host "  --------------" -ForegroundColor DarkYellow

$git = Ensure-Executable "git.exe" "Git.Git" "Git" @("%ProgramFiles%\Git\cmd\git.exe")
$node = Ensure-Executable "node.exe" "OpenJS.NodeJS.LTS" "Node.js LTS" @("%ProgramFiles%\nodejs\node.exe")
$npm = Ensure-Executable "npm.cmd" "OpenJS.NodeJS.LTS" "npm" @("%ProgramFiles%\nodejs\npm.cmd")
$python = Ensure-Executable "python.exe" "Python.Python.3.10" "Python 3.10" @("%LOCALAPPDATA%\Programs\Python\Python310\python.exe")
$ollama = Ensure-Executable "ollama.exe" "Ollama.Ollama" "Ollama" @("%LOCALAPPDATA%\Programs\Ollama\ollama.exe")

if ($Check) {
  if ($git) { Write-Host "[OK]   Git" -ForegroundColor Green }
  if ($node -and $npm) { Write-Host "[OK]   Node.js and npm" -ForegroundColor Green }
  if ($python) { Write-Host "[OK]   Python" -ForegroundColor Green }
  if ($ollama) { Write-Host "[OK]   Ollama" -ForegroundColor Green }
}

if (-not $Check) { New-Item -ItemType Directory -Force -Path $stateDir | Out-Null }

# Node workspace dependencies.
$lockHash = (Get-FileHash (Join-Path $root "package-lock.json") -Algorithm SHA256).Hash
$npmMarker = Join-Path $stateDir "npm-lock.sha256"
$requiredNodeFiles = @(
  "node_modules\.package-lock.json",
  "node_modules\typescript\package.json",
  "node_modules\vitest\package.json",
  "node_modules\@grimoire\client\package.json",
  "node_modules\@grimoire\server\package.json"
)
$missingNodeFiles = @($requiredNodeFiles | Where-Object { -not (Test-Path (Join-Path $root $_)) })
$nodeTreePresent = $missingNodeFiles.Count -eq 0
$markerPresent = Test-Path $npmMarker
$npmReady = $nodeTreePresent -and ((-not $markerPresent) -or ((Get-Content -Raw $npmMarker).Trim() -eq $lockHash))
if ($npmReady) {
  Write-Host "[OK]   Node dependencies" -ForegroundColor Green
  if (-not $Check -and -not $markerPresent) {
    # Adopt a valid pre-bootstrap install without replacing files a running dev server may lock.
    Set-Content -LiteralPath $npmMarker -Value $lockHash -Encoding ASCII
  }
} elseif ($Check) {
  Write-Host "[MISS] Node dependencies need npm ci" -ForegroundColor Yellow
} else {
  Write-Host "[GET]  Installing Node dependencies..." -ForegroundColor Yellow
  Push-Location $root
  try { & $npm ci } finally { Pop-Location }
  if ($LASTEXITCODE -ne 0) { throw "npm ci failed (exit $LASTEXITCODE)." }
  Set-Content -LiteralPath $npmMarker -Value $lockHash -Encoding ASCII
}

# ComfyUI source pinned to the version this project was tested against.
if (-not (Test-Path (Join-Path $comfyDir "main.py"))) {
  if ($Check) {
    Write-Host "[MISS] ComfyUI" -ForegroundColor Yellow
  } else {
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $comfyDir) | Out-Null
    Write-Host "[GET]  Cloning ComfyUI..." -ForegroundColor Yellow
    & $git clone https://github.com/comfyanonymous/ComfyUI.git $comfyDir
    if ($LASTEXITCODE -ne 0) { throw "Could not clone ComfyUI." }
    & $git -C $comfyDir checkout $comfyCommit
    if ($LASTEXITCODE -ne 0) { throw "Could not check out the tested ComfyUI revision." }
  }
} else {
  Write-Host "[OK]   ComfyUI source" -ForegroundColor Green
}

# Shared ComfyUI/Kokoro Python environment.
$venvPython = Join-Path $comfyDir "venv\Scripts\python.exe"
if (-not (Test-Path $venvPython)) {
  if ($Check) {
    Write-Host "[MISS] Python AI environment" -ForegroundColor Yellow
  } else {
    Write-Host "[GET]  Creating Python AI environment..." -ForegroundColor Yellow
    & $python -m venv (Join-Path $comfyDir "venv")
    if ($LASTEXITCODE -ne 0) { throw "Could not create the Python virtual environment." }
    & $venvPython -m pip install --upgrade pip
    & $venvPython -m pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu126
    & $venvPython -m pip install -r (Join-Path $comfyDir "requirements.txt")
    & $venvPython -m pip install -r (Join-Path $root "tools\tts-sidecar\requirements.txt")
    if ($LASTEXITCODE -ne 0) { throw "Python dependency installation failed." }
  }
} elseif ($Check) {
  & $venvPython -c "import aiohttp, kokoro, soundfile, torch"
  if ($LASTEXITCODE -eq 0) {
    Write-Host "[OK]   Python AI environment" -ForegroundColor Green
  } else {
    Write-Host "[MISS] Python narrator dependencies" -ForegroundColor Yellow
  }
} else {
  & $venvPython -c "import aiohttp, kokoro, soundfile, torch" 2>$null
  if ($LASTEXITCODE -ne 0) {
    Write-Host "[GET]  Repairing Python narrator dependencies..." -ForegroundColor Yellow
    & $venvPython -m pip install -r (Join-Path $root "tools\tts-sidecar\requirements.txt")
    if ($LASTEXITCODE -ne 0) { throw "Python narrator dependency installation failed." }
  } else {
    Write-Host "[OK]   Python AI environment" -ForegroundColor Green
  }
}

# Image model files remain local because GitHub cannot host multi-gigabyte weights.
Ensure-Download "DreamShaper 8 checkpoint" `
  "https://huggingface.co/Lykon/DreamShaper/resolve/main/DreamShaper_8_pruned.safetensors" `
  (Join-Path $comfyDir "models\checkpoints\DreamShaper_8_pruned.safetensors") `
  2000000000 "879DB523C30D3B9017143D56705015E15A2CB5628762C11D086FED9538ABD7FD"
Ensure-Download "LCM-LoRA for SD 1.5" `
  "https://huggingface.co/latent-consistency/lcm-lora-sdv1-5/resolve/main/pytorch_lora_weights.safetensors" `
  (Join-Path $comfyDir "models\loras\lcm-lora-sdv15.safetensors") `
  100000000 "8F90D840E075FF588A58E22C6586E2AE9A6F7922996EE6649A7F01072333AFE4"

# Start Ollama long enough to make sure the resident DM model is available.
if ($ollama) {
  if (-not (Test-Http "http://127.0.0.1:11434/api/tags")) {
    if ($Check) {
      Write-Host "[INFO] Ollama is installed but not currently running" -ForegroundColor DarkGray
    } else {
      Write-Host "[BOOT] Starting Ollama for model setup..." -ForegroundColor Yellow
      Start-Process -FilePath $ollama -ArgumentList "serve" -WindowStyle Hidden
      for ($i = 0; $i -lt 30 -and -not (Test-Http "http://127.0.0.1:11434/api/tags"); $i++) {
        Start-Sleep -Seconds 1
      }
      if (-not (Test-Http "http://127.0.0.1:11434/api/tags")) { throw "Ollama did not start." }
    }
  }
  if (Test-Http "http://127.0.0.1:11434/api/tags") {
    $models = (& $ollama list | Out-String)
    if ($models -match "(?m)^llama3\.1:8b\s") {
      Write-Host "[OK]   Ollama model llama3.1:8b" -ForegroundColor Green
    } elseif ($Check) {
      Write-Host "[MISS] Ollama model llama3.1:8b" -ForegroundColor Yellow
    } else {
      Write-Host "[GET]  Pulling Ollama model llama3.1:8b (large one-time download)..." -ForegroundColor Yellow
      & $ollama pull llama3.1:8b
      if ($LASTEXITCODE -ne 0) { throw "Could not pull llama3.1:8b." }
    }
  }
}

if ($Check) {
  Write-Host ""
  Write-Host "Check complete; nothing was changed." -ForegroundColor Cyan
} else {
  Write-Host ""
  Write-Host "Setup complete." -ForegroundColor Green
}

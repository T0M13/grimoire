#!/usr/bin/env bash
# Idempotent Debian/Ubuntu/Fedora/Arch bootstrap for a Linux Grimoire host.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STATE_DIR="$ROOT/var/setup"
COMFY_DIR="$ROOT/vendor/ComfyUI"
COMFY_COMMIT="917faef771a2fd2f14f44af94f17da3d0b2803a3"
NODE_VERSION="22.17.0"
CHECK=0
[[ "${1:-}" == "--check" ]] && CHECK=1
TEMP_OLLAMA_PID=""

cleanup() {
  [[ -n "$TEMP_OLLAMA_PID" ]] && kill "$TEMP_OLLAMA_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

say() { printf '%-7s %s\n' "$1" "$2"; }
as_root() {
  if [[ $EUID -eq 0 ]]; then "$@"; else sudo "$@"; fi
}

install_system_tools() {
  local missing=()
  for command in git curl python3 tar xz sha256sum; do
    command -v "$command" >/dev/null 2>&1 || missing+=("$command")
  done
  python3 -m venv --help >/dev/null 2>&1 || missing+=("python3-venv")
  ((${#missing[@]} == 0)) && return
  if ((CHECK)); then say "[MISS]" "System tools: ${missing[*]}"; return; fi
  if command -v apt-get >/dev/null; then
    as_root apt-get update
    as_root apt-get install -y git curl python3 python3-venv python3-pip tar xz-utils ca-certificates
  elif command -v dnf >/dev/null; then
    as_root dnf install -y git curl python3 python3-pip tar xz ca-certificates
  elif command -v pacman >/dev/null; then
    as_root pacman -Sy --needed git curl python python-pip tar xz ca-certificates
  else
    printf 'Install Git, curl, Python 3 with venv, tar, xz, and sha256sum, then rerun setup.sh.\n' >&2
    exit 1
  fi
}

install_node() {
  if command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1 && [[ "$(node -p 'Number(process.versions.node.split(`.`)[0])')" -ge 22 ]]; then
    NODE="$(command -v node)"; NPM="$(command -v npm)"; say "[OK]" "Node.js $(node --version)"; return
  fi
  local arch archive base destination
  case "$(uname -m)" in
    x86_64) arch=x64 ;;
    aarch64|arm64) arch=arm64 ;;
    *) printf 'Unsupported Linux CPU architecture: %s\n' "$(uname -m)" >&2; exit 1 ;;
  esac
  destination="$ROOT/vendor/node-v$NODE_VERSION-linux-$arch"
  if [[ ! -x "$destination/bin/node" ]]; then
    if ((CHECK)); then say "[MISS]" "Node.js 22+"; return; fi
    mkdir -p "$ROOT/vendor"
    archive="node-v$NODE_VERSION-linux-$arch.tar.xz"
    base="https://nodejs.org/dist/v$NODE_VERSION"
    say "[GET]" "Node.js v$NODE_VERSION"
    curl -fL --retry 3 -o "$ROOT/vendor/$archive" "$base/$archive"
    curl -fL --retry 3 -o "$ROOT/vendor/SHASUMS256.txt" "$base/SHASUMS256.txt"
    (cd "$ROOT/vendor" && grep "  $archive\$" SHASUMS256.txt | sha256sum --check -)
    tar -xJf "$ROOT/vendor/$archive" -C "$ROOT/vendor"
    rm -f "$ROOT/vendor/$archive" "$ROOT/vendor/SHASUMS256.txt"
  fi
  NODE="$destination/bin/node"; NPM="$destination/bin/npm"
  export PATH="$destination/bin:$PATH"
  say "[OK]" "Node.js $($NODE --version)"
}

ensure_download() {
  local label="$1" url="$2" destination="$3" minimum="$4" expected="$5"
  if [[ -f "$destination" && "$(stat -c %s "$destination")" -ge "$minimum" ]]; then say "[OK]" "$label"; return; fi
  if ((CHECK)); then say "[MISS]" "$label"; return; fi
  mkdir -p "$(dirname "$destination")"
  say "[GET]" "$label (large one-time download)"
  curl -fL --retry 3 -o "$destination.download" "$url"
  [[ "$(stat -c %s "$destination.download")" -ge "$minimum" ]] || { rm -f "$destination.download"; echo "$label download is too small" >&2; exit 1; }
  echo "$expected  $destination.download" | sha256sum --check -
  mv "$destination.download" "$destination"
}

http_ok() { curl -fsS --max-time 2 "$1" >/dev/null 2>&1; }

printf '\n  GRIMOIRE LINUX SETUP\n  --------------------\n'
install_system_tools
install_node

if ! command -v ollama >/dev/null 2>&1; then
  if ((CHECK)); then say "[MISS]" "Ollama"; else
    say "[GET]" "Ollama"
    curl -fsSL https://ollama.com/install.sh | sh
  fi
else say "[OK]" "Ollama"; fi

if ((CHECK)) && [[ -z "${NODE:-}" ]]; then
  say "[INFO]" "Run ./setup.sh to install missing requirements"
  exit 0
fi
((CHECK)) || mkdir -p "$STATE_DIR" "$ROOT/var/logs"

LOCK_HASH="$(sha256sum "$ROOT/package-lock.json" | cut -d' ' -f1)"
NPM_MARKER="$STATE_DIR/npm-lock.sha256"
if [[ -f "$ROOT/node_modules/typescript/package.json" && -f "$NPM_MARKER" && "$(tr -d '\r\n' < "$NPM_MARKER" | tr '[:upper:]' '[:lower:]')" == "$LOCK_HASH" ]]; then
  say "[OK]" "Node dependencies"
elif ((CHECK)); then say "[MISS]" "Node dependencies need npm ci"
else
  say "[GET]" "Installing Node dependencies"
  (cd "$ROOT" && "$NPM" ci)
  printf '%s\n' "$LOCK_HASH" > "$NPM_MARKER"
fi

if [[ ! -f "$COMFY_DIR/main.py" ]]; then
  if ((CHECK)); then say "[MISS]" "ComfyUI"
  else
    say "[GET]" "Cloning tested ComfyUI revision"
    git clone https://github.com/comfyanonymous/ComfyUI.git "$COMFY_DIR"
    git -C "$COMFY_DIR" checkout "$COMFY_COMMIT"
  fi
else say "[OK]" "ComfyUI source"; fi

VENV_PY="$COMFY_DIR/venv/bin/python"
if [[ ! -x "$VENV_PY" ]]; then
  if ((CHECK)); then say "[MISS]" "Python AI environment"
  else
    say "[GET]" "Creating Python AI environment"
    python3 -m venv "$COMFY_DIR/venv"
    "$VENV_PY" -m pip install --upgrade pip
    TORCH_INDEX="${GRIMOIRE_TORCH_INDEX_URL:-}"
    if [[ -z "$TORCH_INDEX" ]]; then
      if command -v nvidia-smi >/dev/null 2>&1; then TORCH_INDEX="https://download.pytorch.org/whl/cu126"
      else TORCH_INDEX="https://download.pytorch.org/whl/cpu"; fi
    fi
    "$VENV_PY" -m pip install torch torchvision torchaudio --index-url "$TORCH_INDEX"
    "$VENV_PY" -m pip install -r "$COMFY_DIR/requirements.txt"
    "$VENV_PY" -m pip install -r "$ROOT/tools/tts-sidecar/requirements.txt"
  fi
elif "$VENV_PY" -c 'import aiohttp, kokoro, soundfile, torch' >/dev/null 2>&1; then say "[OK]" "Python AI environment"
elif ((CHECK)); then say "[MISS]" "Python narrator dependencies"
else
  say "[GET]" "Repairing Python narrator dependencies"
  "$VENV_PY" -m pip install -r "$ROOT/tools/tts-sidecar/requirements.txt"
fi

ensure_download "DreamShaper 8 checkpoint" \
  "https://huggingface.co/Lykon/DreamShaper/resolve/main/DreamShaper_8_pruned.safetensors" \
  "$COMFY_DIR/models/checkpoints/DreamShaper_8_pruned.safetensors" 2000000000 \
  "879db523c30d3b9017143d56705015e15a2cb5628762c11d086fed9538abd7fd"
ensure_download "LCM-LoRA for SD 1.5" \
  "https://huggingface.co/latent-consistency/lcm-lora-sdv1-5/resolve/main/pytorch_lora_weights.safetensors" \
  "$COMFY_DIR/models/loras/lcm-lora-sdv15.safetensors" 100000000 \
  "8f90d840e075ff588a58e22c6586e2ae9a6f7922996ee6649a7f01072333afe4"

# Pick the DM model for this machine's hardware (benchmarked tiers; override: GRIMOIRE_DM_MODEL).
# >= 7 GB VRAM -> llama3.1:8b (full experience). Weaker GPU or no NVIDIA -> llama3.2:3b,
# which runs well even on CPU-only machines - the game stays playable on a toaster.
VRAM_MB=0
if command -v nvidia-smi >/dev/null 2>&1; then
  VRAM_MB=$(nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits 2>/dev/null | head -n1 | tr -d '[:space:]')
  [[ "$VRAM_MB" =~ ^[0-9]+$ ]] || VRAM_MB=0
fi
DM_MODEL="${GRIMOIRE_DM_MODEL:-}"
if [[ -z "$DM_MODEL" ]]; then
  if ((VRAM_MB >= 7000)); then DM_MODEL="llama3.1:8b"; else DM_MODEL="llama3.2:3b"; fi
fi
if ((VRAM_MB > 0)); then say "[OK]" "Hardware tier: ${VRAM_MB} MB VRAM -> DM model $DM_MODEL"
else say "[OK]" "Hardware tier: no NVIDIA GPU detected -> DM model $DM_MODEL"; fi
if ((!CHECK)); then
  mkdir -p "$ROOT/var"
  printf '{"dmModel":"%s","detectedVramMB":%s}' "$DM_MODEL" "$VRAM_MB" > "$ROOT/var/host-config.json"
fi

if command -v ollama >/dev/null 2>&1; then
  if ! http_ok "http://127.0.0.1:11434/api/tags" && ((!CHECK)); then
    say "[BOOT]" "Starting Ollama for model setup"
    ollama serve >"$ROOT/var/logs/setup-ollama.log" 2>&1 & TEMP_OLLAMA_PID=$!
    for _ in {1..30}; do http_ok "http://127.0.0.1:11434/api/tags" && break; sleep 1; done
  fi
  if http_ok "http://127.0.0.1:11434/api/tags"; then
    if ollama list | awk '{print $1}' | grep -qx "$DM_MODEL"; then say "[OK]" "Ollama model $DM_MODEL"
    elif ((CHECK)); then say "[MISS]" "Ollama model $DM_MODEL"
    else say "[GET]" "Pulling Ollama model $DM_MODEL"; ollama pull "$DM_MODEL"; fi
  elif ((CHECK)); then say "[INFO]" "Ollama is installed but not running"; else echo "Ollama did not start" >&2; exit 1; fi
fi
if ((CHECK)); then printf '\nCheck complete; nothing was changed.\n'; else printf '\nSetup complete.\n'; fi

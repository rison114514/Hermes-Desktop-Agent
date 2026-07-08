#!/bin/zsh
set -euo pipefail

export PYTHONUTF8=1
export PYTHONIOENCODING=utf-8
export LANG="${LANG:-C.UTF-8}"
export LC_ALL="${LC_ALL:-C.UTF-8}"
export HERMES_TEXT_ENCODING=utf-8
export HERMES_BACKEND=native
export npm_config_registry="${npm_config_registry:-https://registry.npmmirror.com}"
export ELECTRON_MIRROR="${ELECTRON_MIRROR:-https://npmmirror.com/mirrors/electron/}"

cd -- "$(dirname -- "$0")"

export HERMES_HOME="${HERMES_HOME:-$PWD/.hermes-runtime/hermes-home}"
export electron_config_cache="${electron_config_cache:-$PWD/.hermes-runtime/electron-cache}"

if [ -x ".hermes-runtime/hermes-venv/bin/hermes" ]; then
  export PATH="$PWD/.hermes-runtime/hermes-venv/bin:$PATH"
fi

migrate_legacy_hermes_config() {
  local legacy_home="$HOME/Library/Application Support/hermes"
  if [ "$HERMES_HOME" = "$legacy_home" ]; then
    return 0
  fi

  mkdir -p "$HERMES_HOME" "$HERMES_HOME/logs"
  if [ ! -f "$HERMES_HOME/config.yaml" ] && [ -f "$legacy_home/config.yaml" ]; then
    cp "$legacy_home/config.yaml" "$HERMES_HOME/config.yaml"
    chmod 600 "$HERMES_HOME/config.yaml" 2>/dev/null || true
    echo "Migrated existing Hermes config to $HERMES_HOME"
  fi
}

migrate_legacy_hermes_config

echo "============================================"
echo " Hermes Desktop Agent"
echo "============================================"
echo
echo "Starting Hermes Desktop with native macOS backend."
echo

require_command() {
  local name="$1"
  local hint="$2"
  if ! command -v "$name" >/dev/null 2>&1; then
    echo "$name was not found."
    echo "$hint"
    exit 1
  fi
}

require_command node "Install Node.js 20+ from https://nodejs.org/ or Homebrew."
require_command npm "npm is normally installed with Node.js."
require_command hermes "Run setup-hermes-environment.command first to install Hermes Agent."

if ! hermes acp --check >/dev/null 2>&1; then
  echo
  echo "==> Hermes ACP dependencies are missing; running setup repair"
  ./setup-hermes-environment.command
  if [ -x ".hermes-runtime/hermes-venv/bin/hermes" ]; then
    export PATH="$PWD/.hermes-runtime/hermes-venv/bin:$PATH"
    hash -r
  fi
  if ! hermes acp --check >/dev/null 2>&1; then
    echo
    echo "Hermes ACP is still unavailable."
    echo "Please rerun setup-hermes-environment.command and check the pip output above."
    exit 1
  fi
fi

node_major="$(node -p "Number(process.versions.node.split('.')[0])")"
if [ "$node_major" -lt 20 ]; then
  echo "Node.js 20+ is required. Current version: $(node --version)"
  exit 1
fi

run_npm_with_mirrors() {
  ELECTRON_MIRROR="$ELECTRON_MIRROR" \
    electron_config_cache="$electron_config_cache" \
    npm_config_registry="$npm_config_registry" \
    npm "$@" --registry="$npm_config_registry"
}

mkdir -p "$HERMES_HOME"

config_path="$HERMES_HOME/config.yaml"
if [ -f "$config_path" ]; then
  config_content="$(cat "$config_path")"
else
  config_content=""
fi

if printf '%s\n' "$config_content" | grep -q '^approvals:'; then
  if printf '%s\n' "$config_content" | grep -q '^  timeout:'; then
    perl -0pi -e 's/^  timeout:\s*\d+/  timeout: 315360000/m' "$config_path"
  else
    perl -0pi -e 's/^(approvals:\s*)$/$1\n  timeout: 315360000/m' "$config_path"
  fi
else
  printf '\napprovals:\n  timeout: 315360000\n' >> "$config_path"
fi

stamp_path=".hermes-install-stamp"
needs_install=0
if [ ! -f "$stamp_path" ]; then
  needs_install=1
elif [ package.json -nt "$stamp_path" ] || { [ -f package-lock.json ] && [ package-lock.json -nt "$stamp_path" ]; }; then
  needs_install=1
elif [ ! -x "node_modules/.bin/vite" ] || [ ! -x "node_modules/.bin/electron" ]; then
  needs_install=1
fi

if [ "$needs_install" -eq 1 ]; then
  echo
  echo "==> Installing npm dependencies with mirror"
  echo "    npm registry: $npm_config_registry"
  echo "    Electron mirror: $ELECTRON_MIRROR"
  if [ -f package-lock.json ]; then
    run_npm_with_mirrors ci
  else
    run_npm_with_mirrors install
  fi
  touch "$stamp_path"
fi

echo
echo "==> Checking Electron runtime"
if ! node scripts/ensure-electron-runtime.mjs --strict; then
  echo
  echo "Electron runtime could not be repaired automatically."
  echo "Try again later, or run with a custom mirror:"
  echo "  ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ ./start-hermes-desktop.command"
  exit 1
fi

echo
echo "==> Building desktop app"
npm run build

echo
echo "==> Launching Hermes Desktop Agent"
npx electron .

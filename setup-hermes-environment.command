#!/bin/zsh
set -euo pipefail

export PYTHONUTF8=1
export PYTHONIOENCODING=utf-8
export LANG="${LANG:-C.UTF-8}"
export LC_ALL="${LC_ALL:-C.UTF-8}"
export HERMES_TEXT_ENCODING=utf-8

repo_root="$(cd -- "$(dirname -- "$0")" && pwd)"
runtime_dir="${HERMES_RUNTIME_DIR:-$repo_root/.hermes-runtime}"
export HERMES_HOME="${HERMES_HOME:-$runtime_dir/hermes-home}"
venv_dir="$runtime_dir/hermes-venv"
hermes_bin="$venv_dir/bin/hermes"
uv_dir="$runtime_dir/uv"
uv_bin="$uv_dir/uv"
uv_cache_dir="$runtime_dir/uv-cache"
uv_python_dir="$runtime_dir/uv-python"
pip_cache_dir="$runtime_dir/pip-cache"

cd -- "$repo_root"

export UV_CACHE_DIR="$uv_cache_dir"
export UV_PYTHON_INSTALL_DIR="$uv_python_dir"
export PIP_CACHE_DIR="$pip_cache_dir"

echo "============================================"
echo " Hermes Desktop Agent - macOS Setup"
echo "============================================"
echo
echo "This installs Hermes Agent locally for this desktop app."
echo "No sudo, WSL, Docker, or Homebrew is required."
echo "If Python is missing, a local uv runtime will be downloaded automatically."
echo

info() { echo "    $1"; }
ok() { echo "    OK: $1"; }
warn() { echo "    WARN: $1"; }

migrate_legacy_hermes_config() {
  local legacy_home="$HOME/Library/Application Support/hermes"
  if [ "$HERMES_HOME" = "$legacy_home" ]; then
    return 0
  fi

  mkdir -p "$HERMES_HOME" "$HERMES_HOME/logs"
  if [ ! -f "$HERMES_HOME/config.yaml" ] && [ -f "$legacy_home/config.yaml" ]; then
    cp "$legacy_home/config.yaml" "$HERMES_HOME/config.yaml"
    chmod 600 "$HERMES_HOME/config.yaml" 2>/dev/null || true
    ok "Migrated existing Hermes config to $HERMES_HOME"
  fi
}

migrate_legacy_hermes_config

find_python() {
  for candidate in python3 python; do
    if command -v "$candidate" >/dev/null 2>&1; then
      if "$candidate" - <<'PY' >/dev/null 2>&1
import sys
raise SystemExit(0 if sys.version_info >= (3, 10) else 1)
PY
      then
        command -v "$candidate"
        return 0
      fi
    fi
  done
  return 1
}

find_uv() {
  if [ -x "$uv_bin" ]; then
    "$uv_bin" --version >/dev/null 2>&1 && return 0
  fi

  if command -v uv >/dev/null 2>&1; then
    uv --version >/dev/null 2>&1 && return 0
  fi

  return 1
}

current_uv() {
  if [ -x "$uv_bin" ]; then
    printf '%s\n' "$uv_bin"
  else
    command -v uv
  fi
}

install_uv() {
  mkdir -p "$uv_dir"

  local machine target archive tmp_dir
  machine="$(uname -m)"
  case "$machine" in
    arm64) target="aarch64-apple-darwin" ;;
    x86_64) target="x86_64-apple-darwin" ;;
    *)
      echo "Unsupported macOS architecture: $machine"
      exit 1
      ;;
  esac

  archive="uv-$target.tar.gz"
  tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/hermes-uv.XXXXXX")"

  local urls=(
    "https://ghfast.top/https://github.com/astral-sh/uv/releases/latest/download/$archive"
    "https://gh-proxy.com/https://github.com/astral-sh/uv/releases/latest/download/$archive"
    "https://gh.llkk.cc/https://github.com/astral-sh/uv/releases/latest/download/$archive"
    "https://github.com/astral-sh/uv/releases/latest/download/$archive"
  )

  local downloaded=0
  for url in "${urls[@]}"; do
    info "Trying uv download: $url"
    if curl -fL --connect-timeout 20 --max-time 180 "$url" -o "$tmp_dir/$archive"; then
      downloaded=1
      break
    fi
    warn "Failed with $url"
  done

  if [ "$downloaded" -ne 1 ]; then
    echo
    echo "Could not download uv. Network access to GitHub may be blocked or too slow."
    echo "Try again later, or manually install uv and rerun this script:"
    echo "  curl -LsSf https://astral.sh/uv/install.sh | sh"
    exit 1
  fi

  tar -xzf "$tmp_dir/$archive" -C "$tmp_dir"
  local extracted_uv
  extracted_uv="$(find "$tmp_dir" -type f -name uv | head -n 1)"
  if [ -z "$extracted_uv" ]; then
    echo "Downloaded uv archive did not contain an uv executable."
    exit 1
  fi

  cp "$extracted_uv" "$uv_bin"
  chmod +x "$uv_bin"
  rm -rf "$tmp_dir"
  ok "$("$uv_bin" --version) installed at $uv_bin"
}

find_hermes() {
  if [ -x "$hermes_bin" ]; then
    "$hermes_bin" --version >/dev/null 2>&1 && return 0
  fi

  if command -v hermes >/dev/null 2>&1; then
    hermes --version >/dev/null 2>&1 && return 0
  fi

  return 1
}

current_hermes() {
  if [ -x "$hermes_bin" ]; then
    printf '%s\n' "$hermes_bin"
  else
    command -v hermes
  fi
}

check_hermes_acp() {
  if ! find_hermes; then
    return 1
  fi

  "$(current_hermes)" acp --check >/dev/null 2>&1
}

configure_approvals() {
  mkdir -p "$HERMES_HOME"
  local config_path="$HERMES_HOME/config.yaml"
  touch "$config_path"

  if grep -q '^approvals:' "$config_path"; then
    if grep -q '^  timeout:' "$config_path"; then
      perl -0pi -e 's/^  timeout:\s*\d+/  timeout: 315360000/m' "$config_path"
    else
      perl -0pi -e 's/^(approvals:\s*)$/$1\n  timeout: 315360000/m' "$config_path"
    fi
  else
    printf '\napprovals:\n  timeout: 315360000\n' >> "$config_path"
  fi

  ok "Approvals timeout set to 10 years"
}

ensure_pip() {
  if "$venv_dir/bin/python" -m pip --version >/dev/null 2>&1; then
    return 0
  fi

  echo
  echo "==> Installing pip into local Python environment"
  if "$venv_dir/bin/python" -m ensurepip --upgrade --default-pip; then
    ok "pip installed with ensurepip"
    return 0
  fi

  echo
  echo "Could not install pip into the local Python environment."
  echo "Try removing .hermes-runtime/hermes-venv and rerun this script."
  exit 1
}

echo "==> Checking existing Hermes"
if find_hermes; then
  if [ -x "$hermes_bin" ]; then
    ok "$("$hermes_bin" --version) at $hermes_bin"
  else
    ok "$(hermes --version) from PATH"
  fi

  if check_hermes_acp; then
    ok "Hermes ACP dependencies are installed"
    configure_approvals
    echo
    echo "Hermes is ready. You can now start:"
    echo "  ./start-hermes-desktop.command"
    exit 0
  fi

  warn "Hermes is installed, but ACP dependencies are missing; repairing"
else
  echo "    Hermes not found - installing"
fi

mkdir -p "$runtime_dir"

if [ -d "$venv_dir" ] && [ ! -x "$venv_dir/bin/python" ]; then
  warn "Existing local Python environment is incomplete; recreating it"
  rm -rf "$venv_dir"
fi

if [ ! -x "$venv_dir/bin/python" ]; then
  python_bin="$(find_python || true)"

  if [ -n "$python_bin" ]; then
    ok "Using Python: $python_bin"
    echo
    echo "==> Creating local Python environment"
    "$python_bin" -m venv "$venv_dir"
  else
    echo
    echo "==> Python 3.10+ not found; installing local uv runtime"
    if ! find_uv; then
      install_uv
    else
      ok "$( "$(current_uv)" --version )"
    fi

    echo
    echo "==> Creating local Python environment with uv"
    uv_python_mirrors=(
      "https://ghfast.top/https://github.com/astral-sh/python-build-standalone/releases/download"
      "https://gh-proxy.com/https://github.com/astral-sh/python-build-standalone/releases/download"
      "https://gh.llkk.cc/https://github.com/astral-sh/python-build-standalone/releases/download"
      "https://github.com/astral-sh/python-build-standalone/releases/download"
    )

    created=0
    for mirror in "${uv_python_mirrors[@]}"; do
      info "Trying Python mirror: $mirror"
      if UV_PYTHON_INSTALL_MIRROR="$mirror" "$(current_uv)" venv "$venv_dir" --python 3.12 --seed; then
        created=1
        break
      fi
      warn "Failed with $mirror"
    done

    if [ "$created" -ne 1 ]; then
      echo
      echo "Could not create Python environment automatically."
      echo "Network access to Python standalone downloads may be blocked or too slow."
      echo
      echo "Manual fallback:"
      echo "  1. Install Python 3.10+ from https://www.python.org/downloads/macos/"
      echo "  2. Rerun setup-hermes-environment.command"
      exit 1
    fi
  fi
else
  ok "Using existing local Python environment: $venv_dir"
fi

ensure_pip

echo
echo "==> Upgrading pip tooling"
"$venv_dir/bin/python" -m pip install --upgrade pip setuptools wheel \
  --timeout 60 \
  --retries 2 \
  -i https://pypi.tuna.tsinghua.edu.cn/simple \
  --trusted-host pypi.tuna.tsinghua.edu.cn || true

echo
echo "==> Installing Hermes Agent with ACP support"
indexes=(
  "https://pypi.tuna.tsinghua.edu.cn/simple"
  "https://mirrors.aliyun.com/pypi/simple"
  "https://mirrors.cloud.tencent.com/pypi/simple"
  "https://pypi.doubanio.com/simple"
  "https://pypi.org/simple"
)

installed=0
for index in "${indexes[@]}"; do
  host="${index#https://}"
  host="${host%%/*}"
  info "Trying pip index: $index"
  if "$venv_dir/bin/python" -m pip install --upgrade "hermes-agent[acp]" \
    -i "$index" \
    --trusted-host "$host" \
    --timeout 90 \
    --retries 3; then
    installed=1
    ok "Installed Hermes Agent from $index"
    break
  fi
  warn "Failed with $index"
done

if [ "$installed" -ne 1 ]; then
  echo
  echo "Hermes Agent installation failed."
  echo
  echo "Domestic network fallback commands to try manually:"
  echo "  \"$venv_dir/bin/python\" -m pip install --upgrade \"hermes-agent[acp]\" -i https://pypi.tuna.tsinghua.edu.cn/simple --trusted-host pypi.tuna.tsinghua.edu.cn"
  echo "  \"$venv_dir/bin/python\" -m pip install --upgrade \"hermes-agent[acp]\" -i https://mirrors.aliyun.com/pypi/simple --trusted-host mirrors.aliyun.com"
  echo
  echo "After it succeeds, run this setup script again."
  exit 1
fi

if [ ! -x "$hermes_bin" ]; then
  echo
  echo "Hermes installed, but the executable was not found at:"
  echo "  $hermes_bin"
  echo "Check pip output above for details."
  exit 1
fi

echo
echo "==> Verifying Hermes"
"$hermes_bin" --version
"$hermes_bin" acp --check

configure_approvals

echo
echo "============================================"
echo " macOS Hermes setup completed"
echo "============================================"
echo
echo "Next steps:"
echo "  1. Run ./start-hermes-desktop.command"
echo "  2. Or run npm run create:mac-launcher and double-click the generated app"

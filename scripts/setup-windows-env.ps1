# Hermes Desktop Agent - Native Windows one-click environment setup.
#
# Downloads and runs the official Hermes Agent Windows installer (no WSL),
# then configures it for use with Hermes Desktop Agent.
#
# Usage from repo root:
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\setup-windows-env.ps1
# Or just double-click setup-hermes-environment.cmd

param(
  [switch]$SkipApprovals,
  [switch]$InstallBrowserTools
)

$ErrorActionPreference = "Stop"

$Global:ProgressPreference = 'SilentlyContinue'

# Full UTF-8 setup for Chinese Windows (GBK default code page 936).
# Without this, the Hermes installer's box-drawing characters render as garbled.
$utf8NoBom = [System.Text.UTF8Encoding]::new($false)
$utf8Bom   = [System.Text.UTF8Encoding]::new($true)
[Console]::OutputEncoding = $utf8NoBom
[Console]::InputEncoding  = $utf8NoBom
$OutputEncoding = $utf8NoBom
# Force the console code page to UTF-8 (equivalent to chcp 65001)
& chcp.com 65001 2>$null | Out-Null
$env:PYTHONUTF8 = "1"
$env:PYTHONIOENCODING = "utf-8"
$env:LC_ALL = "en_US.UTF-8"

# Use domestic mirrors for every npm/npx child process started by the
# official Hermes installer. Browser tools are optional, but these settings
# also make a later Playwright installation use the domestic binary mirror.
if ([string]::IsNullOrWhiteSpace($env:npm_config_registry)) {
  $env:npm_config_registry = "https://registry.npmmirror.com"
}
if ([string]::IsNullOrWhiteSpace($env:npm_config_disturl)) {
  $env:npm_config_disturl = "https://npmmirror.com/mirrors/node"
}
if ([string]::IsNullOrWhiteSpace($env:ELECTRON_MIRROR)) {
  $env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"
}
if ([string]::IsNullOrWhiteSpace($env:PLAYWRIGHT_DOWNLOAD_HOST)) {
  $env:PLAYWRIGHT_DOWNLOAD_HOST = "https://npmmirror.com/mirrors/playwright"
}
if ([string]::IsNullOrWhiteSpace($env:PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT)) {
  $env:PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT = "180000"
}

function Invoke-Step {
  param(
    [string]$Label,
    [scriptblock]$Command
  )

  Write-Host ""
  Write-Host "==> $Label" -ForegroundColor Cyan
  & $Command
}

function Write-Info {
  param([string]$Message)
  Write-Host "    $Message" -ForegroundColor Gray
}

function Write-Ok {
  param([string]$Message)
  Write-Host "    OK: $Message" -ForegroundColor Green
}

function Write-Warn {
  param([string]$Message)
  Write-Host "    WARN: $Message" -ForegroundColor Yellow
}

# ---- Helper: resolve hermes.exe (PATH or known locations) ----

function Resolve-HermesExe {
  # Returns the best callable hermes (as a string) or $null.
  $cmd = Get-Command "hermes" -ErrorAction SilentlyContinue
  if ($cmd) {
    try {
      $v = & $cmd.Source --version 2>&1
      if ($LASTEXITCODE -eq 0) { return $cmd.Source }
    } catch {}
  }

  $candidates = @(
    "$env:LOCALAPPDATA\hermes\venv\Scripts\hermes.exe",
    "$env:LOCALAPPDATA\hermes\hermes-agent\venv\Scripts\hermes.exe"
  )
  foreach ($c in $candidates) {
    if (Test-Path $c) {
      try {
        $v = & $c --version 2>&1
        if ($LASTEXITCODE -eq 0) {
          # Add to PATH so subsequent steps find it
          $env:PATH = "$(Split-Path $c -Parent);$env:PATH"
          return $c
        }
      } catch {}
    }
  }
  return $null
}

function Resolve-HermesPython {
  param([string]$HermesExe)

  if ([string]::IsNullOrWhiteSpace($HermesExe)) {
    return $null
  }

  $scriptsDir = Split-Path $HermesExe -Parent
  $candidates = @(
    (Join-Path $scriptsDir "python.exe"),
    (Join-Path (Split-Path $scriptsDir -Parent) "python.exe")
  )

  foreach ($candidate in $candidates) {
    if (Test-Path $candidate) {
      try {
        & $candidate --version 2>&1 | Out-Null
        if ($LASTEXITCODE -eq 0) { return $candidate }
      } catch {}
    }
  }

  return $null
}

function Test-HermesAcp {
  param([string]$HermesExe)

  if ([string]::IsNullOrWhiteSpace($HermesExe)) {
    return $false
  }

  try {
    & $HermesExe acp --check 2>&1 | Out-Null
    return $LASTEXITCODE -eq 0
  } catch {
    return $false
  }
}

function Repair-HermesAcp {
  param([string]$HermesExe)

  $pythonExe = Resolve-HermesPython $HermesExe
  if (-not $pythonExe) {
    throw "Hermes ACP dependencies are missing, but the Python runtime for Hermes could not be found. Reinstall Hermes with setup-hermes-environment.cmd."
  }

  $indexes = @(
    "https://pypi.tuna.tsinghua.edu.cn/simple",
    "https://mirrors.aliyun.com/pypi/simple",
    "https://mirrors.cloud.tencent.com/pypi/simple",
    "https://pypi.doubanio.com/simple",
    "https://pypi.org/simple"
  )

  foreach ($index in $indexes) {
    $hostName = ([Uri]$index).Host
    Write-Info "Trying pip index: $index"
    & $pythonExe -m pip install --upgrade "hermes-agent[acp]" -i $index --trusted-host $hostName --timeout 90 --retries 3
    if ($LASTEXITCODE -eq 0 -and (Test-HermesAcp $HermesExe)) {
      Write-Ok "Hermes ACP dependencies installed"
      return
    }
    Write-Warn "Failed with $index"
  }

  throw "Hermes ACP dependencies could not be installed. Try again later or run: `"$pythonExe`" -m pip install --upgrade `"hermes-agent[acp]`""
}

function Resolve-PowerShellHost {
  try {
    $currentHost = (Get-Process -Id $PID).Path
    if ($currentHost -and (Test-Path $currentHost)) {
      return $currentHost
    }
  } catch {}

  $windowsPowerShell = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
  if (Test-Path $windowsPowerShell) {
    return $windowsPowerShell
  }

  $pwsh = Get-Command "pwsh.exe" -ErrorAction SilentlyContinue
  if ($pwsh) {
    return $pwsh.Source
  }

  throw "A PowerShell host could not be resolved for the Hermes installer."
}

function Invoke-HermesInstallerStage {
  param(
    [string]$InstallerPath,
    [string]$Name
  )

  Write-Info "Official installer stage: $Name"
  $powerShellExe = Resolve-PowerShellHost
  & $powerShellExe -NoProfile -ExecutionPolicy Bypass -File $InstallerPath -Stage $Name -NonInteractive
  if ($LASTEXITCODE -ne 0) {
    throw "Hermes installer stage '$Name' failed with exit code $LASTEXITCODE."
  }
}

function Invoke-HermesCoreInstall {
  param([string]$InstallerPath)

  $powerShellExe = Resolve-PowerShellHost
  $manifestOutput = & $powerShellExe -NoProfile -ExecutionPolicy Bypass -File $InstallerPath -Manifest
  if ($LASTEXITCODE -ne 0) {
    throw "The downloaded Hermes installer does not support the required stage protocol."
  }

  try {
    $manifest = ($manifestOutput | Out-String) | ConvertFrom-Json
  } catch {
    throw "The Hermes installer returned an invalid stage manifest: $_"
  }

  $availableStages = @($manifest.stages | ForEach-Object { $_.name })
  $stages = @(
    "uv",
    "python",
    "git"
  )

  if ($InstallBrowserTools) {
    $stages += "node"
  }

  $stages += @(
    "repository",
    "venv",
    "dependencies"
  )

  if ($InstallBrowserTools) {
    $stages += "node-deps"
  }

  $stages += @(
    "path",
    "config-templates",
    "bootstrap-marker"
  )

  foreach ($stage in $stages) {
    if ($availableStages -notcontains $stage) {
      throw "The Hermes installer is missing required stage '$stage'."
    }
    Invoke-HermesInstallerStage -InstallerPath $InstallerPath -Name $stage
  }
}

# ---- Header ----

Write-Host "============================================" -ForegroundColor Magenta
Write-Host " Hermes Desktop Agent - Native Setup" -ForegroundColor Magenta
Write-Host "============================================" -ForegroundColor Magenta
Write-Host ""
Write-Host "This script installs & configures Hermes Agent on Windows." -ForegroundColor White
Write-Host "No WSL / Docker / Hyper-V required." -ForegroundColor White
Write-Host "npm/npx downloads use domestic mirrors." -ForegroundColor White
if ($InstallBrowserTools) {
  Write-Host "Optional Hermes browser tools will also be installed." -ForegroundColor White
} else {
  Write-Host "Optional Playwright Chromium is skipped to keep setup fast and reliable." -ForegroundColor White
}
Write-Host ""

# ---- Pre-check: is Hermes already installed? ----

$script:HermesExe = $null

Invoke-Step "Checking for existing Hermes installation" {
  $found = Resolve-HermesExe
  if ($found) {
    try {
      $v = & $found --version 2>&1
      Write-Ok "Hermes $v already installed at: $found"
      $script:HermesExe = $found
    } catch {
      Write-Info "Hermes binary found but --version failed: $_"
    }
  } else {
    Write-Info "Hermes not found - will download and install"
  }
}

# ---- Step 1: Install (only if not already installed) ----

if (-not $script:HermesExe -or $InstallBrowserTools) {
  Invoke-Step "Installing Hermes Agent (official Windows installer)" {

    $installUrl = "https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.ps1"
    $tempDir = Join-Path $env:TEMP "hermes-setup-$([System.DateTime]::Now.ToString('yyyyMMddHHmmss'))"
    New-Item -ItemType Directory -Force -Path $tempDir | Out-Null
    $installerPath = Join-Path $tempDir "hermes-install.ps1"

    Write-Info "Downloading installer from: $installUrl"

    $downloadOk = $false
    $urls = @(
      $installUrl,
      "https://gh-proxy.com/$installUrl",
      "https://ghfast.top/$installUrl"
    )

    foreach ($url in $urls) {
      try {
        Write-Info "Trying: $url"
        Invoke-WebRequest -Uri $url -OutFile $installerPath -UseBasicParsing -TimeoutSec 30
        if ((Get-Item $installerPath).Length -gt 500) {
          $downloadOk = $true
          Write-Ok "Downloaded installer ($((Get-Item $installerPath).Length) bytes)"
          break
        }
      } catch {
        Write-Warn "Failed: $_"
      }
    }

    if (-not $downloadOk) {
      throw "Could not download the Hermes installer. Please check your internet connection and try again."
    }

    # The official installer calls `powershell` internally (to install uv).
    # On some systems `powershell` may not resolve.  Patching the installer
    # is more reliable than a PATH shim: the installer's Sync-EnvPath resets
    # $env:Path from the registry at every stage, wiping temporary entries.
    Write-Info "Patching installer for powershell.exe path..."
    $psFullPath = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
    $oldCall = '        powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex" 2>&1 | Out-Null'
    $newCall = "        & `"$psFullPath`" -ExecutionPolicy ByPass -c `"irm https://astral.sh/uv/install.ps1 | iex`" 2>&1 | Out-Null"
    $installerContent = [System.IO.File]::ReadAllText($installerPath, $utf8NoBom)
    $installerContent = $installerContent.Replace($oldCall, $newCall)
    [System.IO.File]::WriteAllText($installerPath, $installerContent, $utf8NoBom)

    Write-Info "Running core installer stages (this may take several minutes)..."
    Write-Info "npm registry: $env:npm_config_registry"
    Write-Info "Playwright mirror: $env:PLAYWRIGHT_DOWNLOAD_HOST"
    Write-Host ""

    Invoke-HermesCoreInstall -InstallerPath $installerPath

    Write-Host ""

    # Clean up temp installer
    Remove-Item -Recurse -Force $tempDir -ErrorAction SilentlyContinue

    # Re-resolve hermes after install
    $found = Resolve-HermesExe
    if ($found) {
      $script:HermesExe = $found
      Write-Ok "Hermes ready at: $found"
    } else {
      Write-Warn "Hermes still not on PATH after install."
      Write-Info "This is normal - close and reopen your terminal, then re-run this script."
      Write-Info "It will detect the existing installation and skip straight to setup model."
    }
  }
} else {
  Write-Host ""
  Write-Ok "Skipping install - Hermes already available"
}

# ---- Step 2: Setup model ----

if ($script:HermesExe) {
  Invoke-Step "Checking Hermes ACP dependencies" {
    if (Test-HermesAcp $script:HermesExe) {
      Write-Ok "Hermes ACP dependencies are installed"
    } else {
      Write-Warn "Hermes is installed, but ACP dependencies are missing; repairing"
      Repair-HermesAcp $script:HermesExe
    }
  }

  Invoke-Step "Configuring AI model (hermes setup model)" {
    Write-Info "Launching interactive model setup..."
    Write-Host ""
    & $script:HermesExe setup model
    Write-Host ""
    Write-Ok "Model configuration complete"
  }
} else {
  Write-Warn "Skipping model setup - hermes not available yet"
  Write-Info "Re-run this script after restarting your terminal."
}

# ---- Step 3: Set approvals timeout ----

if ($script:HermesExe -and -not $SkipApprovals) {
  Invoke-Step "Configuring approvals timeout" {
    try {
      & $script:HermesExe config set approvals.timeout 315360000 2>&1 | Out-Null
      Write-Ok "Approvals timeout set to 10 years (effectively infinite)"
    } catch {
      Write-Warn "Could not set approvals timeout: $_"
    }
  }
} elseif (-not $script:HermesExe) {
  Write-Info "Skipping approvals - hermes not available. Run after restart: hermes config set approvals.timeout 315360000"
}

# ---- Done ----

Write-Host ""
Write-Host "============================================" -ForegroundColor Green
Write-Host " Native Hermes setup completed!" -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Green
Write-Host ""

if ($script:HermesExe) {
  Write-Host "All done! Hermes is ready to use." -ForegroundColor White
  if (-not $InstallBrowserTools) {
    Write-Host "Playwright Chromium was not installed; this does not affect ACP or desktop sessions." -ForegroundColor Gray
  }
  Write-Host ""
  Write-Host "Next steps:" -ForegroundColor White
  Write-Host "  1. Start Hermes Desktop: scripts\start-windows.ps1 -Backend native" -ForegroundColor Gray
  Write-Host ""
} else {
  Write-Host "Next steps:" -ForegroundColor White
  Write-Host "  1. Close and reopen your terminal (or restart PC)" -ForegroundColor Gray
  Write-Host "  2. Re-run this script - it will skip install and go to model setup" -ForegroundColor Gray
  Write-Host "  3. Start Hermes Desktop: scripts\start-windows.ps1 -Backend native" -ForegroundColor Gray
  Write-Host ""
}

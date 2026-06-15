# Hermes Desktop Agent - Native Windows one-click environment setup.
#
# Downloads and runs the official Hermes Agent Windows installer (no WSL),
# then configures it for use with Hermes Desktop Agent.
#
# Usage from repo root:
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\setup-native.ps1
# Or just double-click setup-native.cmd

param(
  [switch]$SkipApprovals
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

# ---- Header ----

Write-Host "============================================" -ForegroundColor Magenta
Write-Host " Hermes Desktop Agent - Native Setup" -ForegroundColor Magenta
Write-Host "============================================" -ForegroundColor Magenta
Write-Host ""
Write-Host "This script installs & configures Hermes Agent on Windows." -ForegroundColor White
Write-Host "No WSL / Docker / Hyper-V required." -ForegroundColor White
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

if (-not $script:HermesExe) {
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

    Write-Info "Running installer (this may take several minutes)..."
    Write-Host ""

    & $installerPath
    $installExit = $LASTEXITCODE

    Write-Host ""

    # Clean up temp installer
    Remove-Item -Recurse -Force $tempDir -ErrorAction SilentlyContinue

    if ($installExit -ne 0 -and $installExit -ne $null) {
      Write-Warn "Installer exited with code $installExit (this may be normal)"
    }

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

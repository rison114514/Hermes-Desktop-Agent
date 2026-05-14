param(
  [string]$Distro,
  [switch]$SkipModelSetup
)

$ErrorActionPreference = "Stop"

$utf8NoBom = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = $utf8NoBom
$OutputEncoding = $utf8NoBom
$env:PYTHONUTF8 = "1"
$env:PYTHONIOENCODING = "utf-8"
$env:LANG = "C.UTF-8"
$env:LC_ALL = "C.UTF-8"
$env:HERMES_TEXT_ENCODING = "utf-8"

function Invoke-Step {
  param(
    [string]$Label,
    [scriptblock]$Command
  )

  Write-Host ""
  Write-Host "==> $Label" -ForegroundColor Cyan
  & $Command
}

function Require-Command {
  param(
    [string]$Name,
    [string]$InstallHint
  )

  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "$Name was not found. $InstallHint"
  }
}

function Invoke-Native {
  param(
    [string]$FilePath,
    [string[]]$Arguments,
    [System.Text.Encoding]$Encoding = [System.Text.Encoding]::UTF8
  )

  $psi = [System.Diagnostics.ProcessStartInfo]::new()
  $psi.FileName = $FilePath
  $psi.Arguments = Join-ProcessArguments $Arguments
  $psi.UseShellExecute = $false
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.StandardOutputEncoding = $Encoding
  $psi.StandardErrorEncoding = $Encoding

  $process = [System.Diagnostics.Process]::Start($psi)
  $stdout = $process.StandardOutput.ReadToEnd()
  $stderr = $process.StandardError.ReadToEnd()
  $process.WaitForExit()

  return [pscustomobject]@{
    ExitCode = $process.ExitCode
    Stdout = ($stdout -replace "`0", "").Trim()
    Stderr = ($stderr -replace "`0", "").Trim()
  }
}

function Join-ProcessArguments {
  param([string[]]$Arguments)

  if (-not $Arguments) {
    return ""
  }

  return ($Arguments | ForEach-Object { Quote-ProcessArgument $_ }) -join " "
}

function Quote-ProcessArgument {
  param([string]$Argument)

  if ($null -eq $Argument) {
    return '""'
  }

  if ($Argument -notmatch '[\s"]') {
    return $Argument
  }

  return '"' + ($Argument -replace '(\\*)"', '$1$1\"' -replace '(\\+)$', '$1$1') + '"'
}

function Test-Administrator {
  $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = [System.Security.Principal.WindowsPrincipal]::new($identity)
  return $principal.IsInRole([System.Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Get-WindowsOptionalFeatureState {
  param([string]$FeatureName)

  try {
    $feature = Get-WindowsOptionalFeature -Online -FeatureName $FeatureName -ErrorAction Stop
    return [string]$feature.State
  } catch {
    return "Unknown"
  }
}

function Enable-WslPlatformFeaturesIfNeeded {
  $virtualMachinePlatformState = Get-WindowsOptionalFeatureState "VirtualMachinePlatform"
  if ($virtualMachinePlatformState -ne "Enabled") {
    Enable-HyperVPackagesIfAvailable
  }

  $features = @(
    [pscustomobject]@{
      Name = "Microsoft-Windows-Subsystem-Linux"
      Label = "Windows Subsystem for Linux"
    },
    [pscustomobject]@{
      Name = "VirtualMachinePlatform"
      Label = "Virtual Machine Platform"
    }
  )

  $disabled = @()
  foreach ($feature in $features) {
    $state = Get-WindowsOptionalFeatureState $feature.Name
    Write-Host "$($feature.Label): $state"
    if ($state -ne "Enabled") {
      $disabled += $feature
    }
  }

  if (-not $disabled) {
    return $false
  }

  if (-not (Test-Administrator)) {
    throw @"
WSL platform features are not enabled yet.
Run setup-hermes-environment.cmd as administrator, then run it again.
Required features:
- Microsoft-Windows-Subsystem-Linux
- VirtualMachinePlatform
"@
  }

  foreach ($feature in $disabled) {
    Write-Host "Enabling $($feature.Label)..." -ForegroundColor Yellow
    $result = Invoke-Native "dism.exe" @(
      "/online",
      "/enable-feature",
      "/featurename:$($feature.Name)",
      "/all",
      "/norestart"
    )

    if ($result.ExitCode -ne 0) {
      $message = if ($result.Stderr) { $result.Stderr } else { $result.Stdout }
      throw "Failed to enable $($feature.Label). $message"
    }
  }

  Write-Host ""
  Write-Host "WSL platform features were enabled. Restart Windows, then run this setup again." -ForegroundColor Yellow
  return $true
}

function Enable-HyperVPackagesIfAvailable {
  if (-not (Test-Administrator)) {
    return
  }

  $hyperVState = Get-WindowsOptionalFeatureState "Microsoft-Hyper-V-All"
  if ($hyperVState -eq "Enabled") {
    return
  }

  $packagesDirectory = Join-Path $env:SystemRoot "servicing\Packages"
  $packages = @(Get-ChildItem -Path $packagesDirectory -Filter "*Hyper-V*.mum" -ErrorAction SilentlyContinue)
  if (-not $packages) {
    Write-Host "Hyper-V package manifests were not found. Continuing with standard WSL feature enablement." -ForegroundColor Yellow
    return
  }

  Write-Host "Preparing Hyper-V platform packages for Windows Home compatibility..." -ForegroundColor Yellow
  foreach ($package in $packages) {
    $result = Invoke-Native "dism.exe" @(
      "/online",
      "/norestart",
      "/add-package:$($package.FullName)"
    )

    if ($result.ExitCode -ne 0) {
      $message = if ($result.Stderr) { $result.Stderr } else { $result.Stdout }
      Write-Host "Skipping Hyper-V package $($package.Name). $message" -ForegroundColor Yellow
    }
  }

  Write-Host "Enabling Hyper-V platform feature..." -ForegroundColor Yellow
  $enable = Invoke-Native "dism.exe" @(
    "/online",
    "/enable-feature",
    "/featurename:Microsoft-Hyper-V-All",
    "/LimitAccess",
    "/ALL",
    "/norestart"
  )

  if ($enable.ExitCode -ne 0) {
    $message = if ($enable.Stderr) { $enable.Stderr } else { $enable.Stdout }
    Write-Host "Hyper-V platform feature could not be fully enabled. Continuing with Virtual Machine Platform. $message" -ForegroundColor Yellow
  }
}

function Invoke-WslListVerbose {
  Invoke-Native "wsl.exe" @("-l", "-v") ([System.Text.Encoding]::Unicode)
}

function Test-SystemWslDistro {
  param([string]$Name)
  return $Name -match '^docker-desktop(?:-data)?$'
}

function Test-UbuntuWslDistro {
  param([string]$Name)
  return $Name -match '^Ubuntu(?:[\s-]|$)' -or $Name -match '^HermesUbuntu$'
}

function Get-UsableWslDistro {
  $result = Invoke-WslListVerbose
  if ($result.ExitCode -ne 0) {
    return $null
  }

  $lines = $result.Stdout -split "\r?\n" | ForEach-Object { ($_ -replace "`0", "").TrimEnd() }
  $rows = foreach ($line in $lines) {
    $trimmed = $line.Trim()
    if (-not $trimmed -or $trimmed -match '^NAME\s+STATE\s+VERSION$') {
      continue
    }

    $isDefault = $trimmed.StartsWith("*")
    $clean = $trimmed -replace '^\*\s*', ''
    $match = [regex]::Match($clean, '^(?<name>.+?)\s+(Running|Stopped|Installing|Uninstalling|Converting|Exporting|Importing)\s+\d+\s*$')
    $name = if ($match.Success) { $match.Groups["name"].Value.Trim() } else { ($clean -split "\s{2,}")[0].Trim() }
    if ($name) {
      [pscustomobject]@{
        Name = $name
        Default = $isDefault
        System = Test-SystemWslDistro $name
      }
    }
  }

  $usable = @($rows | Where-Object { -not $_.System })
  if (-not $usable) {
    return $null
  }

  $defaultUsable = $usable | Where-Object { $_.Default } | Select-Object -First 1
  if ($defaultUsable) {
    return $defaultUsable.Name
  }

  return ($usable | Select-Object -First 1).Name
}

function Get-UsableUbuntuWslDistro {
  $result = Invoke-WslListVerbose
  if ($result.ExitCode -ne 0) {
    return $null
  }

  $lines = $result.Stdout -split "\r?\n" | ForEach-Object { ($_ -replace "`0", "").TrimEnd() }
  $rows = foreach ($line in $lines) {
    $trimmed = $line.Trim()
    if (-not $trimmed -or $trimmed -match '^NAME\s+STATE\s+VERSION$') {
      continue
    }

    $isDefault = $trimmed.StartsWith("*")
    $clean = $trimmed -replace '^\*\s*', ''
    $match = [regex]::Match($clean, '^(?<name>.+?)\s+(Running|Stopped|Installing|Uninstalling|Converting|Exporting|Importing)\s+\d+\s*$')
    $name = if ($match.Success) { $match.Groups["name"].Value.Trim() } else { ($clean -split "\s{2,}")[0].Trim() }
    if ($name -and -not (Test-SystemWslDistro $name) -and (Test-UbuntuWslDistro $name)) {
      [pscustomobject]@{
        Name = $name
        Default = $isDefault
      }
    }
  }

  $ubuntu = @($rows)
  if (-not $ubuntu) {
    return $null
  }

  $defaultUbuntu = $ubuntu | Where-Object { $_.Default } | Select-Object -First 1
  if ($defaultUbuntu) {
    return $defaultUbuntu.Name
  }

  return ($ubuntu | Select-Object -First 1).Name
}

function Test-WslDistroExists {
  param([string]$Name)

  $result = Invoke-WslListVerbose
  if ($result.ExitCode -ne 0) {
    return $false
  }

  $lines = $result.Stdout -split "\r?\n" | ForEach-Object { ($_ -replace "`0", "").Trim() }
  return [bool]($lines | Where-Object {
    $line = $_ -replace '^\*\s*', ''
    $line -match ('^' + [regex]::Escape($Name) + '\s+')
  })
}

function Install-WslDefaultDistro {
  Write-Host "No usable WSL Linux distro was found. Docker Desktop distros are not supported." -ForegroundColor Yellow
  Write-Host "Installing Ubuntu through WSL. Windows may request administrator approval or a reboot." -ForegroundColor Yellow

  $result = Invoke-Native "wsl.exe" @("--install", "-d", "Ubuntu")
  if ($result.ExitCode -eq 0) {
    Write-Host "Ubuntu installation command completed."
    return
  }

  $message = if ($result.Stderr) { $result.Stderr } else { $result.Stdout }
  Write-Host "Microsoft Store installation did not complete. Trying web download fallback..." -ForegroundColor Yellow
  if ($message) {
    Write-Host $message -ForegroundColor Yellow
  }

  $webResult = Invoke-Native "wsl.exe" @("--install", "--web-download", "-d", "Ubuntu")
  if ($webResult.ExitCode -eq 0) {
    Write-Host "Ubuntu installation command completed. If Windows asks for a reboot or Ubuntu asks for first-time user setup, finish that step and run this setup again." -ForegroundColor Yellow
    return
  }

  $webMessage = if ($webResult.Stderr) { $webResult.Stderr } else { $webResult.Stdout }
  if ($webMessage) {
    Write-Host $webMessage -ForegroundColor Yellow
  }

  if (Install-UbuntuWithWinget) {
    return
  }

  Import-UbuntuRootfsDistro
}

function Install-UbuntuWithWinget {
  if (-not (Get-Command "winget.exe" -ErrorAction SilentlyContinue)) {
    return $false
  }

  Write-Host "Trying Ubuntu installation through winget..." -ForegroundColor Yellow
  $result = Invoke-Native "winget.exe" @(
    "install",
    "--id",
    "Canonical.Ubuntu.2404",
    "-e",
    "--source",
    "winget",
    "--accept-package-agreements",
    "--accept-source-agreements"
  )

  if (-not [string]::IsNullOrWhiteSpace($result.Stdout)) {
    Write-Host $result.Stdout
  }
  if ($result.ExitCode -ne 0) {
    $message = if ($result.Stderr) { $result.Stderr } else { $result.Stdout }
    if ($message) {
      Write-Host "winget Ubuntu installation did not complete. $message" -ForegroundColor Yellow
    }
    return $false
  }

  Write-Host "winget completed. If Ubuntu opens for first-time setup, finish it and run this setup again." -ForegroundColor Yellow
  return $true
}

function Import-UbuntuRootfsDistro {
  $distroName = "HermesUbuntu"
  if (Test-WslDistroExists $distroName) {
    Write-Host "$distroName already exists."
    return
  }

  Write-Host "Trying direct Ubuntu WSL rootfs import as a final fallback..." -ForegroundColor Yellow
  Write-Host "This downloads the official Canonical Ubuntu 24.04 WSL rootfs, then imports it as $distroName." -ForegroundColor Yellow

  $baseDirectory = Join-Path $env:LOCALAPPDATA "HermesDesktopAgent\wsl"
  $installDirectory = Join-Path $baseDirectory $distroName
  $downloadDirectory = Join-Path $env:TEMP "HermesDesktopAgent"
  $archivePath = Join-Path $downloadDirectory "ubuntu-noble-wsl-amd64.rootfs.tar.gz"
  New-Item -ItemType Directory -Path $installDirectory -Force | Out-Null
  New-Item -ItemType Directory -Path $downloadDirectory -Force | Out-Null

  $urls = @(
    "https://cloud-images.ubuntu.com/wsl/releases/noble/current/ubuntu-noble-wsl-amd64-wsl.rootfs.tar.gz",
    "https://cloud-images.ubuntu.com/wsl/releases/24.04/current/ubuntu-noble-wsl-amd64-wsl.rootfs.tar.gz"
  )

  $downloaded = $false
  foreach ($url in $urls) {
    Write-Host "Downloading Ubuntu rootfs: $url"
    $download = Invoke-Native "curl.exe" @("-L", "--fail", "--retry", "2", "--connect-timeout", "20", "-o", $archivePath, $url)
    if ($download.ExitCode -eq 0 -and (Test-Path $archivePath)) {
      $downloaded = $true
      break
    }

    $message = if ($download.Stderr) { $download.Stderr } else { $download.Stdout }
    if ($message) {
      Write-Host $message -ForegroundColor Yellow
    }
  }

  if (-not $downloaded) {
    throw @"
Automatic Ubuntu installation failed because Microsoft Store/web-download and direct Canonical rootfs download were unavailable.
Manual fallback:
1. Download Ubuntu 24.04 WSL rootfs from https://cloud-images.ubuntu.com/wsl/releases/noble/current/ubuntu-noble-wsl-amd64-wsl.rootfs.tar.gz
2. Run: wsl --import HermesUbuntu "$installDirectory" "<downloaded-rootfs.tar.gz>" --version 2
3. Run this setup again.
"@
  }

  $import = Invoke-Native "wsl.exe" @("--import", $distroName, $installDirectory, $archivePath, "--version", "2")
  if ($import.ExitCode -ne 0) {
    $message = if ($import.Stderr) { $import.Stderr } else { $import.Stdout }
    throw "Downloaded Ubuntu rootfs, but WSL import failed. $message"
  }

  $setDefault = Invoke-Native "wsl.exe" @("--set-default", $distroName)
  if ($setDefault.ExitCode -ne 0) {
    Write-Host "Imported $distroName, but could not set it as default. The setup will still use it directly." -ForegroundColor Yellow
  }

  Write-Host "Imported Ubuntu as WSL distro: $distroName"
}

function Ensure-WslReady {
  Require-Command "wsl.exe" "Enable WSL, install Ubuntu from Microsoft Store, launch Ubuntu once, then run this setup again."

  $status = Invoke-Native "wsl.exe" @("--status")
  if ($status.ExitCode -ne 0) {
    throw @"
WSL is not ready yet.
Install Ubuntu from Microsoft Store after Windows restart, launch Ubuntu once to finish first-time setup, then run this setup again.
If Microsoft Store download fails, close proxy/VPN and retry.
"@
  }

  $detected = Get-UsableUbuntuWslDistro
  if (-not $detected) {
    throw @"
No usable Ubuntu WSL distro was found.
Please install Ubuntu from Microsoft Store, close proxy/VPN if Store download returns 403, launch Ubuntu once to finish first-time setup, then run this setup again.
Docker Desktop distros are not supported.
"@
  }

  return $detected
}

function Invoke-WslBash {
  param(
    [string]$DistroName,
    [string]$Script
  )

  $scriptFile = New-WslScriptFile $Script
  try {
    wsl.exe -d $DistroName -- bash $scriptFile.WslPath
    if ($LASTEXITCODE -ne 0) {
      throw "WSL command failed with exit code $LASTEXITCODE."
    }
  } finally {
    Remove-Item -LiteralPath $scriptFile.WindowsPath -Force -ErrorAction SilentlyContinue
  }
}

function New-WslScriptFile {
  param([string]$Script)

  $tempRoot = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
  $tempDirectory = Join-Path $tempRoot ".hermes-tmp"
  New-Item -ItemType Directory -Path $tempDirectory -Force | Out-Null
  $windowsPath = Join-Path $tempDirectory ("wsl-" + [guid]::NewGuid().ToString("N") + ".sh")
  [System.IO.File]::WriteAllText($windowsPath, $Script, $utf8NoBom)

  return [pscustomobject]@{
    WindowsPath = $windowsPath
    WslPath = Convert-WindowsPathToWslPath $windowsPath
  }
}

function Convert-WindowsPathToWslPath {
  param([string]$WindowsPath)

  $fullPath = [System.IO.Path]::GetFullPath($WindowsPath)
  if ($fullPath -notmatch "^([A-Za-z]):\\(.*)$") {
    throw "Cannot convert non-drive Windows path to WSL path: $fullPath"
  }

  $drive = $matches[1].ToLowerInvariant()
  $rest = $matches[2] -replace "\\", "/"
  return "/mnt/$drive/$rest"
}

function Ensure-WslBasics {
  param([string]$DistroName)

  Invoke-Step "Checking WSL basics" {
    $script = @'
set -e
missing=''
for cmd in git curl bash; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    missing="$missing $cmd"
  fi
done
if [ -n "$missing" ]; then
  if command -v apt-get >/dev/null 2>&1; then
    run_apt() {
      if [ "$(id -u)" -eq 0 ]; then
        apt-get "$@"
      elif command -v sudo >/dev/null 2>&1; then
        sudo apt-get "$@"
      else
        echo "Missing sudo and current user is not root. Install git and curl in this WSL distro, then run this setup again."
        exit 1
      fi
    }
    run_apt update
    run_apt install -y git curl ca-certificates
  else
    echo "Missing required commands:$missing"
    echo "Install git and curl in this WSL distro, then run this setup again."
    exit 1
  fi
fi
'@
    Invoke-WslBash $DistroName $script
  }
}

function Ensure-HermesInstalled {
  param([string]$DistroName)

  Invoke-Step "Checking Hermes in WSL" {
    $check = Invoke-Native "wsl.exe" @("-d", $DistroName, "--", "bash", "-lc", 'export PATH="$HOME/.local/bin:$PATH"; command -v hermes >/dev/null 2>&1 && hermes --version >/dev/null 2>&1')
    if ($check.ExitCode -eq 0) {
      Write-Host "Hermes is installed."
      return
    }

    Write-Host "Hermes was not found. Installing Hermes Agent in WSL..." -ForegroundColor Yellow
    $script = @'
set -e
export PATH="$HOME/.local/bin:$PATH"
export PYTHONUTF8=1
export PYTHONIOENCODING=utf-8
export LANG=C.UTF-8
export LC_ALL=C.UTF-8
export PIP_INDEX_URL="${PIP_INDEX_URL:-https://pypi.tuna.tsinghua.edu.cn/simple}"
export UV_INDEX_URL="${UV_INDEX_URL:-https://pypi.tuna.tsinghua.edu.cn/simple}"
export npm_config_registry="${npm_config_registry:-https://registry.npmmirror.com}"

install_urls="
https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh
https://gh-proxy.com/https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh
https://ghfast.top/https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh
"

installed=0
for url in $install_urls; do
  echo "Trying Hermes installer: $url"
  if curl -fsSL "$url" -o /tmp/hermes-install.sh; then
    bash /tmp/hermes-install.sh
    rm -f /tmp/hermes-install.sh
    installed=1
    break
  fi
done

if [ "$installed" != "1" ]; then
  echo "Unable to download Hermes installer." >&2
  exit 1
fi

command -v hermes >/dev/null 2>&1
hermes --version
'@
    Invoke-WslBash $DistroName $script
  }
}

function Ensure-HermesModelConfigured {
  param([string]$DistroName)

  if ($SkipModelSetup) {
    Write-Host "Skipping Hermes model setup by request." -ForegroundColor Yellow
    return
  }

  Invoke-Step "Checking Hermes model configuration" {
    $script = @'
set -e
export PATH="$HOME/.local/bin:$PATH"
if hermes config check >/tmp/hermes-config-check.log 2>&1 && hermes doctor >/tmp/hermes-doctor.log 2>&1; then
  echo "Hermes configuration looks ready."
  exit 0
fi

echo ""
echo "Hermes model/provider is not fully configured."
echo "Follow the wizard, choose a provider, enter API credentials, and select a model."
echo "DeepSeek reference: choose DeepSeek, Base URL https://api.deepseek.com, model deepseek-v4-pro."
echo ""
hermes model
echo ""
echo "Rechecking Hermes configuration..."
hermes config check
'@
    Invoke-WslBash $DistroName $script
  }
}

function Test-HermesAcp {
  param([string]$DistroName)

  Invoke-Step "Checking Hermes ACP" {
    Invoke-WslBash $DistroName 'export PATH="$HOME/.local/bin:$PATH"; command -v hermes >/dev/null && hermes acp --help >/dev/null'
    Write-Host "Hermes ACP is available."
  }
}

Invoke-Step "Checking Windows WSL platform" {
  if (Enable-WslPlatformFeaturesIfNeeded) {
    exit 3010
  }
}

Invoke-Step "Checking WSL availability" {
  if ([string]::IsNullOrWhiteSpace($Distro)) {
    $script:Distro = Ensure-WslReady
  } elseif (Test-SystemWslDistro $Distro) {
    throw "$Distro is a Docker Desktop internal distro and cannot run Hermes. Use Ubuntu or another regular Linux distro."
  }
  Write-Host "Using WSL distro: $script:Distro"
}

$env:HERMES_WSL_DISTRO = $Distro

Invoke-Step "Checking WSL distro: $Distro" {
  Invoke-WslBash $Distro "printf 'WSL: '; uname -sr"
}

Ensure-WslBasics $Distro
Ensure-HermesInstalled $Distro
Ensure-HermesModelConfigured $Distro
Test-HermesAcp $Distro

Write-Host ""
Write-Host "Hermes environment is ready. You can now launch Hermes Desktop Agent." -ForegroundColor Green

param(
  [string]$Distro,
  [switch]$AutoDetectDistro,
  [switch]$Build,
  [switch]$SkipBootstrap
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

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $repoRoot

function Require-Command {
  param(
    [string]$Name,
    [string]$InstallHint
  )

  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "$Name was not found. $InstallHint"
  }
}

function Require-NodeRuntime {
  if (-not (Get-Command "node" -ErrorAction SilentlyContinue)) {
    throw @"
Windows 宿主机没有检测到 Node.js。

如果你是普通用户，建议先运行 setup-hermes-environment.cmd 完成环境配置，然后下载并运行 Release EXE。

如果你要从源码 ZIP / git clone 本地启动，请先安装 Windows 版 Node.js 20+：
https://nodejs.cn/download/

安装完成后重新打开终端，再运行 start-hermes-desktop.cmd。
"@
  }

  $versionText = (& node --version 2>$null).Trim()
  $major = 0
  if ($versionText -match '^v(?<major>\d+)') {
    $major = [int]$matches.major
  }

  if ($major -lt 20) {
    throw @"
当前 Windows Node.js 版本过低：$versionText

源码启动需要 Node.js 20+。请安装新版 Windows Node.js：
https://nodejs.cn/download/
"@
  }

  if (-not (Get-Command "npm" -ErrorAction SilentlyContinue)) {
    throw @"
Windows 宿主机没有检测到 npm。

npm 通常会随 Node.js 一起安装。请重新安装 Windows 版 Node.js 20+：
https://nodejs.cn/download/
"@
  }
}

function Invoke-Native {
  param(
    [string]$FilePath,
    [string[]]$Arguments
  )

  $psi = [System.Diagnostics.ProcessStartInfo]::new()
  $psi.FileName = $FilePath
  $psi.Arguments = Join-ProcessArguments $Arguments
  $psi.UseShellExecute = $false
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.StandardOutputEncoding = [System.Text.Encoding]::UTF8
  $psi.StandardErrorEncoding = [System.Text.Encoding]::UTF8

  $process = [System.Diagnostics.Process]::Start($psi)
  $stdout = $process.StandardOutput.ReadToEnd()
  $stderr = $process.StandardError.ReadToEnd()
  $process.WaitForExit()

  return [pscustomobject]@{
    ExitCode = $process.ExitCode
    Stdout = $stdout
    Stderr = $stderr
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

function Invoke-Step {
  param(
    [string]$Label,
    [scriptblock]$Command
  )

  Write-Host ""
  Write-Host "==> $Label" -ForegroundColor Cyan
  & $Command
}

function Invoke-Npm {
  param([string[]]$Arguments)

  & npm @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "npm $($Arguments -join ' ') failed with exit code $LASTEXITCODE."
  }
}

function Test-WindowsNpmDependencies {
  $stampPath = Join-Path $repoRoot ".hermes-install-stamp"
  if (-not (Test-Path $stampPath)) {
    return $false
  }

  $stampTime = (Get-Item $stampPath).LastWriteTime
  $packageJson = Join-Path $repoRoot "package.json"
  $packageLock = Join-Path $repoRoot "package-lock.json"

  if ((Get-Item $packageJson).LastWriteTime -gt $stampTime) {
    return $false
  }

  if ((Test-Path $packageLock) -and (Get-Item $packageLock).LastWriteTime -gt $stampTime) {
    return $false
  }

  $requiredBins = @(
    "node_modules\.bin\vite.cmd",
    "node_modules\.bin\cross-env.cmd",
    "node_modules\.bin\electron.cmd"
  )

  foreach ($relativePath in $requiredBins) {
    if (-not (Test-Path (Join-Path $repoRoot $relativePath))) {
      return $false
    }
  }

  return $true
}

function Install-WindowsNpmDependencies {
  Invoke-Step "Installing Windows npm dependencies" {
    $stampPath = Join-Path $repoRoot ".hermes-install-stamp"
    Remove-Item $stampPath -Force -ErrorAction SilentlyContinue

    if (Test-Path (Join-Path $repoRoot "package-lock.json")) {
      Invoke-Npm @("ci")
    } else {
      Invoke-Npm @("install")
    }

    New-Item -ItemType File -Path $stampPath -Force | Out-Null
  }
}

function Test-SystemWslDistro {
  param([string]$Name)
  return $Name -match '^docker-desktop(?:-data)?$'
}

function Get-WslDistroNameFromLine {
  param([string]$Line)

  $clean = $Line.Trim() -replace "^\*\s*", ""
  $match = [regex]::Match($clean, "^(?<name>.+?)\s+(Running|Stopped|Installing|Uninstalling|Converting|Exporting|Importing)\s+\d+\s*$")
  if ($match.Success) {
    return $match.Groups["name"].Value.Trim()
  }

  $parts = $clean -split "\s{2,}"
  if ($parts.Length -gt 0 -and -not [string]::IsNullOrWhiteSpace($parts[0])) {
    return $parts[0].Trim()
  }

  return $null
}

function Get-DefaultWslDistro {
  $result = Invoke-WslListVerbose
  if ($result.ExitCode -ne 0) {
    $message = if (-not [string]::IsNullOrWhiteSpace($result.Stdout)) { $result.Stdout } else { $result.Stderr }
    throw "Unable to list WSL distros with 'wsl.exe -l -v'. $message"
  }

  $lines = $result.Stdout -split "\r?\n" | ForEach-Object { ($_ -replace "`0", "").TrimEnd() }
  $rows = foreach ($line in $lines) {
    $trimmed = $line.Trim()
    if (-not $trimmed -or $trimmed -match "^NAME\s+STATE\s+VERSION$") {
      continue
    }

    $name = Get-WslDistroNameFromLine $trimmed
    if ($name) {
      [pscustomobject]@{
        Name = $name
        Default = $trimmed.StartsWith("*")
        System = Test-SystemWslDistro $name
      }
    }
  }

  $usable = @($rows | Where-Object { -not $_.System })
  if (-not $usable) {
    throw "No usable WSL Linux distro was found. Docker Desktop distros are not supported."
  }

  $defaultUsable = $usable | Where-Object { $_.Default } | Select-Object -First 1
  if ($defaultUsable) {
    return $defaultUsable.Name
  }

  return ($usable | Select-Object -First 1).Name
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

function Invoke-WslListVerbose {
  $psi = [System.Diagnostics.ProcessStartInfo]::new()
  $psi.FileName = "wsl.exe"
  $psi.Arguments = "-l -v"
  $psi.UseShellExecute = $false
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.StandardOutputEncoding = [System.Text.Encoding]::Unicode
  $psi.StandardErrorEncoding = [System.Text.Encoding]::Unicode

  $process = [System.Diagnostics.Process]::Start($psi)
  $stdout = $process.StandardOutput.ReadToEnd()
  $stderr = $process.StandardError.ReadToEnd()
  $process.WaitForExit()

  return [pscustomobject]@{
    ExitCode = $process.ExitCode
    Stdout = $stdout
    Stderr = $stderr
  }
}

function Install-WslDefaultDistro {
  Write-Host "WSL or a Linux distro is not ready. Attempting automatic WSL installation..." -ForegroundColor Yellow
  Write-Host "Windows may request administrator approval or a reboot during this step." -ForegroundColor Yellow

  $result = Invoke-Native "wsl.exe" @("--install", "-d", "Ubuntu")
  if (-not [string]::IsNullOrWhiteSpace($result.Stdout)) {
    Write-Host $result.Stdout.Trim()
  }
  if ($result.ExitCode -ne 0) {
    $message = if (-not [string]::IsNullOrWhiteSpace($result.Stderr)) { $result.Stderr } else { $result.Stdout }
    Write-Host "WSL Store installation did not complete. Trying web download fallback..." -ForegroundColor Yellow
    if (-not [string]::IsNullOrWhiteSpace($message)) {
      Write-Host $message.Trim() -ForegroundColor Yellow
    }

    $webResult = Invoke-Native "wsl.exe" @("--install", "--web-download", "-d", "Ubuntu")
    if (-not [string]::IsNullOrWhiteSpace($webResult.Stdout)) {
      Write-Host $webResult.Stdout.Trim()
    }
    if ($webResult.ExitCode -eq 0) {
      Write-Host "WSL installation command completed. If Windows asks for a reboot, restart and run this launcher again." -ForegroundColor Yellow
      return
    }

    $webMessage = if (-not [string]::IsNullOrWhiteSpace($webResult.Stderr)) { $webResult.Stderr } else { $webResult.Stdout }
    if (-not [string]::IsNullOrWhiteSpace($webMessage)) {
      Write-Host $webMessage.Trim() -ForegroundColor Yellow
    }

    if (Install-UbuntuWithWinget) {
      return
    }

    Import-UbuntuRootfsDistro
  }

  Write-Host "WSL installation command completed. If Windows asks for a reboot, restart and run this launcher again." -ForegroundColor Yellow
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
    Write-Host $result.Stdout.Trim()
  }
  if ($result.ExitCode -ne 0) {
    $message = if (-not [string]::IsNullOrWhiteSpace($result.Stderr)) { $result.Stderr } else { $result.Stdout }
    if (-not [string]::IsNullOrWhiteSpace($message)) {
      Write-Host "winget Ubuntu installation did not complete. $($message.Trim())" -ForegroundColor Yellow
    }
    return $false
  }

  Write-Host "winget completed. If Ubuntu opens for first-time setup, finish it and launch again." -ForegroundColor Yellow
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

    $message = if (-not [string]::IsNullOrWhiteSpace($download.Stderr)) { $download.Stderr } else { $download.Stdout }
    if (-not [string]::IsNullOrWhiteSpace($message)) {
      Write-Host $message.Trim() -ForegroundColor Yellow
    }
  }

  if (-not $downloaded) {
    throw @"
Automatic Ubuntu installation failed because Microsoft Store/web-download and direct Canonical rootfs download were unavailable.
Manual fallback:
1. Download Ubuntu 24.04 WSL rootfs from https://cloud-images.ubuntu.com/wsl/releases/noble/current/ubuntu-noble-wsl-amd64-wsl.rootfs.tar.gz
2. Run: wsl --import HermesUbuntu "$installDirectory" "<downloaded-rootfs.tar.gz>" --version 2
3. Launch Hermes Desktop Agent again.
"@
  }

  $import = Invoke-Native "wsl.exe" @("--import", $distroName, $installDirectory, $archivePath, "--version", "2")
  if ($import.ExitCode -ne 0) {
    $message = if (-not [string]::IsNullOrWhiteSpace($import.Stderr)) { $import.Stderr } else { $import.Stdout }
    throw "Downloaded Ubuntu rootfs, but WSL import failed. $message"
  }

  $setDefault = Invoke-Native "wsl.exe" @("--set-default", $distroName)
  if ($setDefault.ExitCode -ne 0) {
    Write-Host "Imported $distroName, but could not set it as default. The launcher will still detect it." -ForegroundColor Yellow
  }

  Write-Host "Imported Ubuntu as WSL distro: $distroName"
}

function Ensure-WslReady {
  Require-Command "wsl.exe" "Install WSL from Microsoft Store or run 'wsl --install -d Ubuntu' in an elevated PowerShell."

  $status = Invoke-Native "wsl.exe" @("--status")
  if ($status.ExitCode -ne 0) {
    Install-WslDefaultDistro
  }

  $list = Invoke-WslListVerbose
  $hasDistro = $false
  if ($list.ExitCode -eq 0) {
    $lines = $list.Stdout -split "\r?\n" | ForEach-Object { ($_ -replace "`0", "").Trim() }
    $hasDistro = [bool]($lines | Where-Object {
      $name = Get-WslDistroNameFromLine $_
      $name -and -not (Test-SystemWslDistro $name)
    })
  }

  if (-not $hasDistro) {
    Install-WslDefaultDistro
  }
}

function Invoke-WslBash {
  param(
    [string]$DistroName,
    [string]$Script
  )

  $scriptFile = New-WslScriptFile $Script
  try {
    $result = Invoke-Native "wsl.exe" @("-d", $DistroName, "--", "bash", $scriptFile.WslPath)
    if (-not [string]::IsNullOrWhiteSpace($result.Stdout)) {
      Write-Host $result.Stdout.TrimEnd()
    }
    if ($result.ExitCode -ne 0) {
      $message = if (-not [string]::IsNullOrWhiteSpace($result.Stderr)) { $result.Stderr } else { $result.Stdout }
      throw $message
    }
  } finally {
    Remove-Item -LiteralPath $scriptFile.WindowsPath -Force -ErrorAction SilentlyContinue
  }
}

function Invoke-WslBashInteractive {
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

  $tempDirectory = Join-Path $repoRoot ".hermes-tmp"
  New-Item -ItemType Directory -Path $tempDirectory -Force | Out-Null
  $windowsPath = Join-Path $tempDirectory ("wsl-" + [guid]::NewGuid().ToString("N") + ".sh")
  $lfScript = ($Script -replace "`r`n", "`n") -replace "`r", "`n"
  [System.IO.File]::WriteAllText($windowsPath, $lfScript, $utf8NoBom)

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
        echo "Missing sudo and current user is not root. Install git and curl in this WSL distro, then run the launcher again."
        exit 1
      fi
    }
    run_apt update
    run_apt install -y git curl ca-certificates
  else
    echo "Missing required commands:$missing"
    echo "Install git and curl in this WSL distro, then run the launcher again."
    exit 1
  fi
fi
'@
    Invoke-WslBashInteractive $DistroName $script
  }
}

function Ensure-HermesInstalled {
  param([string]$DistroName)

  Invoke-Step "Checking Hermes in WSL" {
    $check = Invoke-Native "wsl.exe" @("-d", $DistroName, "--", "bash", "-lc", "command -v hermes >/dev/null 2>&1 && hermes --version >/dev/null 2>&1")
    if ($check.ExitCode -eq 0) {
      Write-Host "Hermes is installed."
      return
    }

    Write-Host "Hermes was not found. Installing Hermes Agent in WSL..." -ForegroundColor Yellow
    $script = @'
set -e
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

for url in $install_urls; do
  echo "Trying Hermes installer: $url"
  if curl -fsSL "$url" -o /tmp/hermes-install.sh; then
    bash /tmp/hermes-install.sh
    rm -f /tmp/hermes-install.sh
    break
  fi
done

if ! command -v hermes >/dev/null 2>&1; then
  export PATH="$HOME/.local/bin:$PATH"
fi

command -v hermes >/dev/null 2>&1
hermes --version
'@
    Invoke-WslBashInteractive $DistroName $script
  }
}

function Ensure-HermesModelConfigured {
  param([string]$DistroName)

  Invoke-Step "Checking Hermes model configuration" {
    $script = @'
set -e
export PATH="$HOME/.local/bin:$PATH"
if hermes config check >/tmp/hermes-config-check.log 2>&1; then
  if hermes doctor >/tmp/hermes-doctor.log 2>&1; then
    echo "Hermes configuration looks ready."
    exit 0
  fi
fi

echo ""
echo "Hermes model/provider is not fully configured."
echo "Official flow: run 'hermes model' outside a chat session, choose a provider, enter API credentials, then launch Hermes again."
echo "DeepSeek reference: choose DeepSeek, Base URL https://api.deepseek.com, model deepseek-v4-pro."
echo ""
echo "Starting Hermes model setup wizard now..."
hermes model
echo ""
echo "Rechecking Hermes configuration..."
hermes config check
'@
    Invoke-WslBashInteractive $DistroName $script
  }
}

Require-NodeRuntime

if (-not $SkipBootstrap) {
  Invoke-Step "Checking WSL availability" {
    Ensure-WslReady
  }
} else {
  Require-Command "wsl.exe" "Enable WSL2 and install a Linux distro."
}

if (-not $AutoDetectDistro -and [string]::IsNullOrWhiteSpace($Distro)) {
  $Distro = $env:HERMES_WSL_DISTRO
}

if ($AutoDetectDistro -or [string]::IsNullOrWhiteSpace($Distro)) {
  Invoke-Step "Detecting default WSL distro" {
    $script:Distro = Get-DefaultWslDistro
    Write-Host "Using WSL distro: $script:Distro"
  }
}

$env:HERMES_WSL_DISTRO = $Distro

Invoke-Step "Checking WSL distro: $Distro" {
  Invoke-WslBash $Distro "printf 'WSL: '; uname -sr"
}

if (-not $SkipBootstrap) {
  Ensure-WslBasics $Distro
  Ensure-HermesInstalled $Distro
  Ensure-HermesModelConfigured $Distro
}

Invoke-Step "Checking Hermes ACP in WSL" {
  Invoke-WslBash $Distro 'export PATH="$HOME/.local/bin:$PATH"; command -v hermes >/dev/null && hermes acp --help >/dev/null'
}

if (-not (Test-WindowsNpmDependencies)) {
  Write-Host "Windows npm dependencies are missing, outdated, or incomplete." -ForegroundColor Yellow
  Install-WindowsNpmDependencies
}

function Test-BuildCurrent {
  $stampPath = Join-Path $repoRoot ".hermes-build-stamp"
  if (-not (Test-Path $stampPath)) {
    return $false
  }

  $stampTime = (Get-Item $stampPath).LastWriteTime
  $srcDirs = @("src", "electron")
  $srcFiles = Get-ChildItem -Path ($srcDirs | ForEach-Object { Join-Path $repoRoot $_ }) -Recurse -File -ErrorAction SilentlyContinue
  foreach ($file in $srcFiles) {
    if ($file.LastWriteTime -gt $stampTime) {
      return $false
    }
  }

  if ((Get-Item (Join-Path $repoRoot "package.json")).LastWriteTime -gt $stampTime) {
    return $false
  }

  $lockPath = Join-Path $repoRoot "package-lock.json"
  if ((Test-Path $lockPath) -and (Get-Item $lockPath).LastWriteTime -gt $stampTime) {
    return $false
  }

  $outputs = @("dist\index.html", "dist-electron\electron\main.js")
  foreach ($relativePath in $outputs) {
    if (-not (Test-Path (Join-Path $repoRoot $relativePath))) {
      return $false
    }
  }

  return $true
}

function Invoke-Build {
  Invoke-Step "Building renderer and Electron main process" {
    $stampPath = Join-Path $repoRoot ".hermes-build-stamp"
    Remove-Item $stampPath -Force -ErrorAction SilentlyContinue

    Invoke-Npm @("run", "build")

    New-Item -ItemType File -Path $stampPath -Force | Out-Null
  }
}

if ($Build -or -not (Test-BuildCurrent)) {
  Invoke-Build
}

Invoke-Step "Starting Hermes Desktop Agent" {
  Invoke-Npm @("run", "electron:windows")
}

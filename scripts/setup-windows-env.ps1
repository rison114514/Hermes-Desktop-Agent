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

function Test-Administrator {
  $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = [System.Security.Principal.WindowsPrincipal]::new($identity)
  return $principal.IsInRole([System.Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Require-Administrator {
  if (-not (Test-Administrator)) {
    throw "This step needs administrator rights. Right-click setup-hermes-environment.cmd and choose Run as administrator."
  }
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

function Join-ProcessArguments {
  param([string[]]$Arguments)

  if (-not $Arguments) {
    return ""
  }

  return ($Arguments | ForEach-Object { Quote-ProcessArgument $_ }) -join " "
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

function Get-NativeOutputText {
  param($Result)

  $parts = @($Result.Stdout, $Result.Stderr) |
    Where-Object { -not [string]::IsNullOrWhiteSpace($_) } |
    ForEach-Object { $_.Trim() }

  return ($parts -join "`n")
}

function Test-NativeSuccess {
  param($Result)

  $output = Get-NativeOutputText $Result
  return $Result.ExitCode -eq 0 `
    -or $Result.ExitCode -eq 3010 `
    -or $output -match "The operation completed successfully"
}

function Assert-NativeSuccess {
  param(
    [string]$Label,
    $Result
  )

  if (Test-NativeSuccess $Result) {
    return
  }

  $message = Get-NativeOutputText $Result
  if ($message -match "0xc1900401") {
    throw @"
Failed to complete ${Label}: DISM returned 0xc1900401.
This usually means Windows has a pending component/update transaction. Restart Windows, then run this setup again.

$message
"@
  }

  throw "Failed to complete $Label. $message"
}

function Get-WindowsOptionalFeatureStateText {
  param([string]$FeatureName)

  try {
    $feature = Get-WindowsOptionalFeature -Online -FeatureName $FeatureName -ErrorAction Stop
    return [string]$feature.State
  } catch {
    return "Unknown"
  }
}

function Enable-HyperVIfNeeded {
  $state = Get-WindowsOptionalFeatureStateText "Microsoft-Hyper-V-All"
  Write-Host "Hyper-V: $state"

  if ($state -eq "Enabled") {
    return $false
  }
  if ($state -match "Pending") {
    Write-Host "Hyper-V is pending. Restart Windows, then run this setup again." -ForegroundColor Yellow
    return $true
  }

  Require-Administrator

  $packageDirectory = Join-Path $env:SystemRoot "servicing\Packages"
  $packages = @(Get-ChildItem -Path $packageDirectory -Filter "*Hyper-V*.mum" -ErrorAction SilentlyContinue)
  if (-not $packages) {
    Write-Host "No Hyper-V package manifests were found under $packageDirectory." -ForegroundColor Yellow
  } else {
    Write-Host "Preparing Hyper-V packages for Windows Home compatibility..." -ForegroundColor Yellow
    foreach ($package in $packages) {
      $result = Invoke-Native "dism.exe" @(
        "/online",
        "/norestart",
        "/add-package:$($package.FullName)"
      )

      if (-not (Test-NativeSuccess $result)) {
        $message = Get-NativeOutputText $result
        Write-Host "Skipped Hyper-V package $($package.Name). $message" -ForegroundColor Yellow
      }
    }
  }

  Write-Host "Enabling Hyper-V feature..." -ForegroundColor Yellow
  $enable = Invoke-Native "dism.exe" @(
    "/online",
    "/enable-feature",
    "/featurename:Microsoft-Hyper-V-All",
    "/LimitAccess",
    "/ALL",
    "/norestart"
  )
  Assert-NativeSuccess "Hyper-V enablement" $enable

  Write-Host "Hyper-V was enabled. Restart Windows, then run this setup again." -ForegroundColor Yellow
  return $true
}

function Enable-WindowsFeatureIfNeeded {
  param(
    [string]$FeatureName,
    [string]$Label
  )

  $state = Get-WindowsOptionalFeatureStateText $FeatureName
  Write-Host "${Label}: $state"

  if ($state -eq "Enabled") {
    return $false
  }
  if ($state -match "Pending") {
    Write-Host "$Label is pending. Restart Windows, then run this setup again." -ForegroundColor Yellow
    return $true
  }

  Require-Administrator
  Write-Host "Enabling $Label..." -ForegroundColor Yellow
  try {
    $result = Enable-WindowsOptionalFeature -Online -FeatureName $FeatureName -All -NoRestart -ErrorAction Stop
    if ($result.RestartNeeded) {
      Write-Host "$Label was enabled and needs a Windows restart." -ForegroundColor Yellow
    } else {
      Write-Host "$Label was enabled." -ForegroundColor Yellow
    }
    return $true
  } catch {
    throw "Failed to enable $Label. $($_.Exception.Message)"
  }
}

function Ensure-WindowsPlatform {
  $restartNeeded = $false

  if (Enable-HyperVIfNeeded) {
    $restartNeeded = $true
  }

  if (Enable-WindowsFeatureIfNeeded "Microsoft-Windows-Subsystem-Linux" "Windows Subsystem for Linux") {
    $restartNeeded = $true
  }

  if (Enable-WindowsFeatureIfNeeded "VirtualMachinePlatform" "Virtual Machine Platform") {
    $restartNeeded = $true
  }

  if ($restartNeeded) {
    Write-Host ""
    Write-Host "Windows virtualization/WSL features changed. Restart Windows, then run this setup again." -ForegroundColor Yellow
    exit 3010
  }
}

function Ensure-WslRuntime {
  Require-Command "wsl.exe" "Install WSL from Microsoft Store or run 'wsl --install --no-distribution' in an elevated PowerShell."

  $status = Invoke-Native "wsl.exe" @("--status")
  if ($status.ExitCode -eq 0) {
    if (-not [string]::IsNullOrWhiteSpace($status.Stdout)) {
      Write-Host $status.Stdout
    }
    return
  }

  Write-Host "WSL runtime is not ready. Installing WSL runtime without a Linux distribution..." -ForegroundColor Yellow
  $install = Invoke-Native "wsl.exe" @("--install", "--no-distribution")
  if (Test-NativeSuccess $install) {
    Write-Host "WSL runtime installation command completed."
    return
  }

  $message = Get-NativeOutputText $install
  throw @"
WSL runtime installation failed.
Install WSL manually, then run this setup again:
1. Open an elevated PowerShell.
2. Run: wsl --install --no-distribution
3. If Microsoft download is blocked, install the official WSL MSI manually.

$message
"@
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
  return $Name -match '^Ubuntu(?:[\s-]|$)'
}

function Get-WslDistroRows {
  $result = Invoke-WslListVerbose
  if ($result.ExitCode -ne 0) {
    return @()
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
        Ubuntu = Test-UbuntuWslDistro $name
      }
    }
  }

  return @($rows)
}

function Ensure-UbuntuDistro {
  if (-not [string]::IsNullOrWhiteSpace($Distro)) {
    if (Test-SystemWslDistro $Distro) {
      throw "$Distro is a Docker Desktop internal distro and cannot run Hermes. Use Ubuntu instead."
    }
    return $Distro
  }

  $rows = Get-WslDistroRows
  $ubuntuRows = @($rows | Where-Object { -not $_.System -and $_.Ubuntu })
  if ($ubuntuRows) {
    $defaultUbuntu = $ubuntuRows | Where-Object { $_.Default } | Select-Object -First 1
    if ($defaultUbuntu) {
      return $defaultUbuntu.Name
    }
    return ($ubuntuRows | Select-Object -First 1).Name
  }

  $names = ($rows | ForEach-Object { $_.Name }) -join ", "
  if ([string]::IsNullOrWhiteSpace($names)) {
    $names = "(none)"
  }

  throw @"
No usable Ubuntu WSL distro was found. Current distros: $names
Docker Desktop distros are not supported.

Install Ubuntu first, then run this setup again:
1. Open Microsoft Store and install Ubuntu.
2. If Store download returns 403 or is very slow, close proxy/VPN and retry.
3. Launch Ubuntu once and complete the first-time Linux user setup.
"@
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

function New-WslScriptFile {
  param([string]$Script)

  $tempRoot = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
  $tempDirectory = Join-Path $tempRoot ".hermes-tmp"
  New-Item -ItemType Directory -Path $tempDirectory -Force | Out-Null
  $windowsPath = Join-Path $tempDirectory ("wsl-" + [guid]::NewGuid().ToString("N") + ".sh")
  $lfScript = ($Script -replace "`r`n", "`n") -replace "`r", "`n"
  [System.IO.File]::WriteAllText($windowsPath, $lfScript, $utf8NoBom)

  return [pscustomobject]@{
    WindowsPath = $windowsPath
    WslPath = Convert-WindowsPathToWslPath $windowsPath
  }
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

function Test-WslBash {
  param(
    [string]$DistroName,
    [string]$Script
  )

  $scriptFile = New-WslScriptFile $Script
  try {
    wsl.exe -d $DistroName -- bash $scriptFile.WslPath
    return $LASTEXITCODE -eq 0
  } finally {
    Remove-Item -LiteralPath $scriptFile.WindowsPath -Force -ErrorAction SilentlyContinue
  }
}

function ConvertTo-ShellSingleQuoted {
  param([string]$Value)
  return "'" + ($Value -replace "'", "'\''") + "'"
}

function Ensure-WslBasics {
  param([string]$DistroName)

  Invoke-Step "Checking WSL basics" {
    $script = @'
set -e

missing=''
for cmd in bash git curl; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    missing="$missing $cmd"
  fi
done

if [ -n "$missing" ]; then
  if ! command -v apt-get >/dev/null 2>&1; then
    echo "Missing required commands:$missing"
    echo "Install git, curl, and ca-certificates in Ubuntu, then run this setup again."
    exit 1
  fi

  if [ "$(id -u)" -eq 0 ]; then
    apt-get update
    apt-get install -y git curl ca-certificates
  elif command -v sudo >/dev/null 2>&1; then
    sudo apt-get update
    sudo apt-get install -y git curl ca-certificates
  else
    echo "Missing sudo and current user is not root. Install git, curl, and ca-certificates in Ubuntu, then run this setup again."
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
    $checkScript = 'export PATH="$HOME/.local/bin:$PATH"; command -v hermes >/dev/null 2>&1 && hermes --version >/dev/null 2>&1'
    if (Test-WslBash $DistroName $checkScript) {
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
  echo "Unable to download Hermes installer. Check network access, then run this setup again." >&2
  exit 1
fi

command -v hermes >/dev/null 2>&1
hermes --version
'@
    Invoke-WslBash $DistroName $script
  }
}

function Set-HermesDeepSeekConfig {
  param(
    [string]$DistroName,
    [string]$ApiKey
  )

  $apiKeyLiteral = ConvertTo-ShellSingleQuoted $ApiKey
  $scriptTemplate = @'
set -e

export PATH="$HOME/.local/bin:$PATH"
mkdir -p "$HOME/.hermes"

api_key=__DEEPSEEK_API_KEY__
escaped_api_key=$(printf '%s' "$api_key" | sed "s/'/''/g")

if [ -f "$HOME/.hermes/config.yaml" ]; then
  cp "$HOME/.hermes/config.yaml" "$HOME/.hermes/config.yaml.bak.$(date +%s)"
fi

cat > "$HOME/.hermes/config.yaml" <<EOF
model:
  provider: deepseek
  default: deepseek-v4-pro
providers:
  deepseek:
    api_key: '$escaped_api_key'
    base_url: https://api.deepseek.com
EOF

hermes config check
'@

  $script = $scriptTemplate.Replace("__DEEPSEEK_API_KEY__", $apiKeyLiteral)
  Invoke-WslBash $DistroName $script
}

function Ensure-HermesModelConfigured {
  param([string]$DistroName)

  if ($SkipModelSetup) {
    Write-Host "Skipping Hermes model setup by request." -ForegroundColor Yellow
    return
  }

  Invoke-Step "Checking Hermes model configuration" {
    $checkScript = @'
set -e
export PATH="$HOME/.local/bin:$PATH"
hermes config check >/dev/null 2>&1
'@
    if (Test-WslBash $DistroName $checkScript) {
      Write-Host "Hermes model configuration exists."
      return
    }

    Write-Host "Hermes model is not configured." -ForegroundColor Yellow
    Write-Host "Default provider: DeepSeek"
    Write-Host "Default model: deepseek-v4-pro"
    Write-Host "Base URL: https://api.deepseek.com"
    $apiKey = Read-Host "Paste DeepSeek API key, or press Enter to skip and configure manually later"

    if ([string]::IsNullOrWhiteSpace($apiKey)) {
      Write-Host "Skipped model configuration. Configure later inside Ubuntu with: hermes model" -ForegroundColor Yellow
      return
    }

    try {
      Set-HermesDeepSeekConfig $DistroName $apiKey
      Write-Host "DeepSeek configuration was written."
    } catch {
      Write-Host "Automatic DeepSeek configuration did not pass Hermes validation." -ForegroundColor Yellow
      Write-Host "Falling back to the official Hermes model wizard." -ForegroundColor Yellow
      $wizardScript = @'
set -e
export PATH="$HOME/.local/bin:$PATH"
hermes model
hermes config check
'@
      Invoke-WslBash $DistroName $wizardScript
    }
  }
}

function Test-HermesAcp {
  param([string]$DistroName)

  Invoke-Step "Checking Hermes ACP" {
    $script = 'export PATH="$HOME/.local/bin:$PATH"; command -v hermes >/dev/null 2>&1 && hermes acp --help >/dev/null'
    Invoke-WslBash $DistroName $script
    Write-Host "Hermes ACP is available."
  }
}

Invoke-Step "Checking Windows platform features" {
  Ensure-WindowsPlatform
}

Invoke-Step "Checking WSL runtime" {
  Ensure-WslRuntime
}

Invoke-Step "Detecting Ubuntu WSL distro" {
  $script:Distro = Ensure-UbuntuDistro
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

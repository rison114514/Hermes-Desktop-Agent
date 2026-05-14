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
    if (Test-Path (Join-Path $repoRoot "package-lock.json")) {
      Invoke-Npm @("ci")
    } else {
      Invoke-Npm @("install")
    }
  }
}

function Get-DefaultWslDistro {
  $result = Invoke-WslListVerbose
  if ($result.ExitCode -ne 0) {
    $message = if (-not [string]::IsNullOrWhiteSpace($result.Stdout)) { $result.Stdout } else { $result.Stderr }
    throw "Unable to list WSL distros with 'wsl.exe -l -v'. $message"
  }

  $lines = $result.Stdout -split "\r?\n" | ForEach-Object { ($_ -replace "`0", "").TrimEnd() }
  $defaultLine = $lines | Where-Object { $_.TrimStart().StartsWith("*") } | Select-Object -First 1
  $candidateLine = if ($defaultLine) {
    $defaultLine
  } else {
    $lines | Where-Object {
      $line = $_.Trim()
      $line -and $line -notmatch "^NAME\s+STATE\s+VERSION$"
    } | Select-Object -First 1
  }

  if (-not $candidateLine) {
    throw "No WSL distro was found. Install a WSL distro or pass -Distro <name>."
  }

  $clean = $candidateLine.Trim() -replace "^\*\s*", ""
  $match = [regex]::Match($clean, "^(?<name>.+?)\s+(Running|Stopped|Installing|Uninstalling|Converting|Exporting|Importing)\s+\d+\s*$")
  if ($match.Success) {
    return $match.Groups["name"].Value.Trim()
  }

  $parts = $clean -split "\s{2,}"
  if ($parts.Length -gt 0 -and -not [string]::IsNullOrWhiteSpace($parts[0])) {
    return $parts[0].Trim()
  }

  throw "Unable to parse WSL distro from: $candidateLine"
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
    if ($webResult.ExitCode -ne 0) {
      $webMessage = if (-not [string]::IsNullOrWhiteSpace($webResult.Stderr)) { $webResult.Stderr } else { $webResult.Stdout }
      throw "Automatic WSL installation did not complete. Run 'wsl --install --web-download -d Ubuntu' from an elevated PowerShell, restart Windows if prompted, then launch this script again. $webMessage"
    }
  }

  Write-Host "WSL installation command completed. If Windows asks for a reboot, restart and run this launcher again." -ForegroundColor Yellow
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
    $hasDistro = [bool]($lines | Where-Object { $_ -and $_ -notmatch "^NAME\s+STATE\s+VERSION$" })
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

  $result = Invoke-Native "wsl.exe" @("-d", $DistroName, "--", "bash", "-lc", $Script)
  if (-not [string]::IsNullOrWhiteSpace($result.Stdout)) {
    Write-Host $result.Stdout.TrimEnd()
  }
  if ($result.ExitCode -ne 0) {
    $message = if (-not [string]::IsNullOrWhiteSpace($result.Stderr)) { $result.Stderr } else { $result.Stdout }
    throw $message
  }
}

function Invoke-WslBashInteractive {
  param(
    [string]$DistroName,
    [string]$Script
  )

  wsl.exe -d $DistroName -- bash -lc $Script
  if ($LASTEXITCODE -ne 0) {
    throw "WSL command failed with exit code $LASTEXITCODE."
  }
}

function Ensure-WslBasics {
  param([string]$DistroName)

  Invoke-Step "Checking WSL basics" {
    $script = @"
set -e
missing=''
for cmd in git curl bash; do
  if ! command -v "\$cmd" >/dev/null 2>&1; then
    missing="\$missing \$cmd"
  fi
done
if [ -n "\$missing" ]; then
  if command -v apt-get >/dev/null 2>&1; then
    sudo apt-get update
    sudo apt-get install -y git curl ca-certificates
  else
    echo "Missing required commands:\$missing"
    echo "Install git and curl in this WSL distro, then run the launcher again."
    exit 1
  fi
fi
"@
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

Require-Command "node" "Install Node.js 20+ for Windows."
Require-Command "npm" "Install npm 10+ for Windows."

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
  Write-Host "Windows npm dependencies are missing or incomplete." -ForegroundColor Yellow
  Install-WindowsNpmDependencies
}

$rendererBuilt = Test-Path (Join-Path $repoRoot "dist\index.html")
$mainBuilt = Test-Path (Join-Path $repoRoot "dist-electron\electron\main.js")

if ($Build -or -not ($rendererBuilt -and $mainBuilt)) {
  Invoke-Step "Building renderer and Electron main process" {
    Invoke-Npm @("run", "build")
  }
}

Invoke-Step "Starting Hermes Desktop Agent" {
  Invoke-Npm @("run", "electron:windows")
}

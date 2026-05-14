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

function Invoke-WslListVerbose {
  Invoke-Native "wsl.exe" @("-l", "-v") ([System.Text.Encoding]::Unicode)
}

function Test-SystemWslDistro {
  param([string]$Name)
  return $Name -match '^docker-desktop(?:-data)?$'
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
  if ($webResult.ExitCode -ne 0) {
    $webMessage = if ($webResult.Stderr) { $webResult.Stderr } else { $webResult.Stdout }
    throw "Automatic Ubuntu installation did not complete. Run 'wsl --install --web-download -d Ubuntu' from an elevated PowerShell, restart Windows if prompted, then run this setup again. $webMessage"
  }

  Write-Host "Ubuntu installation command completed. If Windows asks for a reboot or Ubuntu asks for first-time user setup, finish that step and run this setup again." -ForegroundColor Yellow
}

function Ensure-WslReady {
  Require-Command "wsl.exe" "Install WSL from Microsoft Store or run 'wsl --install -d Ubuntu' in an elevated PowerShell."

  $status = Invoke-Native "wsl.exe" @("--status")
  if ($status.ExitCode -ne 0) {
    Install-WslDefaultDistro
  }

  $detected = Get-UsableWslDistro
  if (-not $detected) {
    Install-WslDefaultDistro
    $detected = Get-UsableWslDistro
  }

  if (-not $detected) {
    throw "No usable WSL distro is ready yet. Finish Ubuntu first-run setup, then run this setup again."
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
    sudo apt-get update
    sudo apt-get install -y git curl ca-certificates
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

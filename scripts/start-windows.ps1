param(
  [string]$Distro,
  [switch]$AutoDetectDistro,
  [switch]$Build
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

function Invoke-Step {
  param(
    [string]$Label,
    [scriptblock]$Command
  )

  Write-Host ""
  Write-Host "==> $Label" -ForegroundColor Cyan
  & $Command
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

Require-Command "node" "Install Node.js 20+ for Windows."
Require-Command "npm" "Install npm 10+ for Windows."
Require-Command "wsl.exe" "Enable WSL2 and install a Linux distro."

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
  wsl.exe -d $Distro -- bash -lc "printf 'WSL: '; uname -sr"
}

Invoke-Step "Checking Hermes ACP in WSL" {
  wsl.exe -d $Distro -- bash -lc "command -v hermes >/dev/null && hermes acp --help >/dev/null"
}

if (-not (Test-Path (Join-Path $repoRoot "node_modules"))) {
  Invoke-Step "Installing Windows npm dependencies" {
    npm install
  }
}

$rendererBuilt = Test-Path (Join-Path $repoRoot "dist\index.html")
$mainBuilt = Test-Path (Join-Path $repoRoot "dist-electron\electron\main.js")

if ($Build -or -not ($rendererBuilt -and $mainBuilt)) {
  Invoke-Step "Building renderer and Electron main process" {
    npm run build
  }
}

Invoke-Step "Starting Hermes Desktop Agent" {
  npm run electron:windows
}

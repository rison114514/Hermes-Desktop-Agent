param(
  [string]$Distro = $env:HERMES_WSL_DISTRO,
  [switch]$Build
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $repoRoot

if ([string]::IsNullOrWhiteSpace($Distro)) {
  $Distro = "Ubuntu-22.04"
}

$env:HERMES_WSL_DISTRO = $Distro

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

Require-Command "node" "Install Node.js 20+ for Windows."
Require-Command "npm" "Install npm 10+ for Windows."
Require-Command "wsl.exe" "Enable WSL2 and install a Linux distro."

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

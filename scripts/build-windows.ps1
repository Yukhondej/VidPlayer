param(
  [Parameter(Mandatory = $true, Position = 0)]
  [ValidateSet("x86_64-pc-windows-msvc", "aarch64-pc-windows-msvc")]
  [string]$Target
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot

Push-Location $projectRoot
try {
  & npm.cmd run tauri -- build --target $Target
  if ($LASTEXITCODE -ne 0) {
    throw "Tauri build failed with exit code $LASTEXITCODE."
  }
}
finally {
  Pop-Location
}

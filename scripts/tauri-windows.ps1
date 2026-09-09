param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$TauriArguments
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$target = $null
$targetIndex = [Array]::IndexOf($TauriArguments, "--target")

if ($targetIndex -ge 0) {
  if (($targetIndex + 1) -ge $TauriArguments.Count) {
    throw "--target requires a Rust target triple."
  }
  $target = $TauriArguments[$targetIndex + 1]
} elseif ($TauriArguments.Count -gt 0 -and $TauriArguments[0] -in @("dev", "build")) {
  $target = "x86_64-pc-windows-msvc"
  $TauriArguments += @("--target", $target)
}

if ($target -in @("x86_64-pc-windows-msvc", "aarch64-pc-windows-msvc")) {
  & (Join-Path $PSScriptRoot "stage-windows-libraries.ps1") $target
}

& (Join-Path $projectRoot "node_modules\.bin\tauri.cmd") @TauriArguments
exit $LASTEXITCODE

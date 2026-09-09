param(
  [Parameter(Mandatory = $true, Position = 0)]
  [ValidateSet("x86_64-pc-windows-msvc", "aarch64-pc-windows-msvc")]
  [string]$Target
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$libRoot = Join-Path $projectRoot "src-tauri\lib"
$architecture = if ($Target -eq "x86_64-pc-windows-msvc") { "x86_64" } else { "aarch64" }
$expectedMachine = if ($architecture -eq "x86_64") { 0x8664 } else { 0xAA64 }
$sourceDirectory = Join-Path $libRoot $architecture
$libraryNames = @("libmpv-2.dll", "libmpv-wrapper.dll")

function Get-PeMachine([string]$Path) {
  $bytes = [System.IO.File]::ReadAllBytes($Path)
  if ($bytes.Length -lt 64 -or $bytes[0] -ne 0x4D -or $bytes[1] -ne 0x5A) {
    throw "$Path is not a valid PE file."
  }

  $peOffset = [BitConverter]::ToInt32($bytes, 0x3C)
  if ($peOffset -lt 0 -or ($peOffset + 6) -gt $bytes.Length) {
    throw "$Path has an invalid PE header."
  }

  return [BitConverter]::ToUInt16($bytes, $peOffset + 4)
}

foreach ($libraryName in $libraryNames) {
  $sourcePath = Join-Path $sourceDirectory $libraryName
  if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) {
    throw "Missing $architecture library: $sourcePath"
  }

  $actualMachine = Get-PeMachine $sourcePath
  if ($actualMachine -ne $expectedMachine) {
    throw ("Wrong architecture for {0}: expected PE machine 0x{1:X4}, found 0x{2:X4}." -f $sourcePath, $expectedMachine, $actualMachine)
  }

  Copy-Item -LiteralPath $sourcePath -Destination (Join-Path $libRoot $libraryName) -Force
}

Write-Output "Staged $architecture libmpv libraries for $Target."

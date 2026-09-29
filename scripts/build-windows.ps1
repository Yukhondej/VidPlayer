param(
  [Parameter(Mandatory = $true, Position = 0)]
  [ValidateSet("x86_64-pc-windows-msvc", "aarch64-pc-windows-msvc")]
  [string]$Target
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot

Push-Location $projectRoot
try {
  & npm.cmd run tauri -- build --target $Target --bundles msi
  if ($LASTEXITCODE -ne 0) {
    throw "Tauri build failed with exit code $LASTEXITCODE."
  }

  $config = Get-Content (Join-Path $projectRoot "src-tauri\tauri.conf.json") -Raw | ConvertFrom-Json
  $version = [Version]$config.version
  $releaseVersion = if ($version.Build -eq 0) {
    "{0}.{1}" -f $version.Major, $version.Minor
  } else {
    "{0}.{1}.{2}" -f $version.Major, $version.Minor, $version.Build
  }
  $architecture = if ($Target -eq "x86_64-pc-windows-msvc") { "x64" } else { "arm64" }
  $bundleDirectory = Join-Path $projectRoot "src-tauri\target\$Target\release\bundle\msi"
  $generatedInstaller = Join-Path $bundleDirectory ("VidPlayer_{0}_{1}_en-US.msi" -f $config.version, $architecture)
  $releaseInstaller = Join-Path $bundleDirectory ("VidPlayer_{0}_{1}.msi" -f $releaseVersion, $architecture)
  if (-not (Test-Path -LiteralPath $generatedInstaller -PathType Leaf)) {
    throw "Missing Tauri MSI: $generatedInstaller"
  }

  $installer = New-Object -ComObject WindowsInstaller.Installer
  $database = $installer.OpenDatabase($generatedInstaller, 0)
  $view = $database.OpenView('SELECT `Value` FROM `Property` WHERE `Property` = ''ProductVersion''')
  $view.Execute()
  $record = $view.Fetch()
  $productVersion = if ($record) { $record.StringData(1) } else { "" }
  $view.Close()
  if ($record) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($record) }
  [void][Runtime.InteropServices.Marshal]::ReleaseComObject($view)
  [void][Runtime.InteropServices.Marshal]::ReleaseComObject($database)
  [void][Runtime.InteropServices.Marshal]::ReleaseComObject($installer)
  if ($productVersion -ne $config.version) {
    throw "MSI version $productVersion does not match application version $($config.version)."
  }

  Move-Item -LiteralPath $generatedInstaller -Destination $releaseInstaller -Force
  Write-Output "Release installer: $releaseInstaller"
}
finally {
  Pop-Location
}

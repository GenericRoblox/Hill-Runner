# Stamps out the two portal builds from the game in the repo root.
#
#   .\tools\build-platforms.ps1          # refresh builds\crazygames + builds\poki
#   .\tools\build-platforms.ps1 -Zip     # ...and zip each one for upload
#   .\tools\build-platforms.ps1 -Only poki
#
# Each output folder is a complete, standalone game — serve it on its own, or
# upload the zip. The ONLY files that differ from the base game are index.html
# (adds the portal's SDK script) and src/core/Platform.js (its SDK guts), both
# taken from tools\platform\<name>\. Everything else is a straight copy, so the
# fix is always: edit the base game, re-run this script.

param(
  [switch]$Zip,
  [ValidateSet('crazygames', 'poki')]
  [string]$Only
)

$ErrorActionPreference = 'Stop'

$root      = Split-Path -Parent $PSScriptRoot
$buildsDir = Join-Path $root 'builds'

# Shipped: the game and its assets. Everything else (test harnesses, docs, the
# editor's dev pages, git/tooling) stays home — Poki explicitly asks you to
# strip dev artifacts, and CrazyGames has no use for them either.
$content = @('index.html', 'style.css', 'src', 'lib', 'font', 'music', 'sprites', 'textures')

$targets = if ($Only) { @($Only) } else { @('crazygames', 'poki') }

foreach ($name in $targets) {
  $src  = Join-Path $root "tools\platform\$name"
  $dest = Join-Path $buildsDir $name

  if (-not (Test-Path $src)) { throw "No platform overlay at $src" }

  Write-Host "Building $name ..." -ForegroundColor Cyan

  if (Test-Path $dest) { Remove-Item -Recurse -Force $dest }
  New-Item -ItemType Directory -Force -Path $dest | Out-Null

  foreach ($item in $content) {
    $from = Join-Path $root $item
    if (-not (Test-Path $from)) { throw "Missing game content: $from" }
    Copy-Item -Path $from -Destination $dest -Recurse -Force
  }

  # Overlay the portal's two files on top of the copy.
  Copy-Item -Path (Join-Path $src 'index.html')  -Destination (Join-Path $dest 'index.html') -Force
  Copy-Item -Path (Join-Path $src 'Platform.js') -Destination (Join-Path $dest 'src\core\Platform.js') -Force

  $sizeMB = [math]::Round(((Get-ChildItem -Recurse -File $dest | Measure-Object Length -Sum).Sum / 1MB), 2)
  Write-Host "  -> $dest  ($sizeMB MB)" -ForegroundColor Green

  if ($Zip) {
    $zipPath = Join-Path $buildsDir "hillrunner-$name.zip"
    if (Test-Path $zipPath) { Remove-Item -Force $zipPath }
    # Zip the CONTENTS, not the folder: both portals expect index.html at the root of the archive.
    Compress-Archive -Path (Join-Path $dest '*') -DestinationPath $zipPath
    $zipMB = [math]::Round(((Get-Item $zipPath).Length / 1MB), 2)
    Write-Host "  -> $zipPath  ($zipMB MB)" -ForegroundColor Green
  }
}

Write-Host "`nDone. Serve a build locally with:" -ForegroundColor Cyan
Write-Host "  cd builds\$($targets[0]); python -m http.server 8001"

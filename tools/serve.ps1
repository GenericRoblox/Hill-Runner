# Serves the game over HTTP and opens it — the game CANNOT run from file://
# (browsers block ES modules there, so you get an empty hillside and no menu).
#
#   .\tools\serve.ps1                 # the base game        -> localhost:8000
#   .\tools\serve.ps1 -Build poki     # builds\poki          -> localhost:8000
#   .\tools\serve.ps1 -Build crazygames -Port 8001

param(
  [ValidateSet('base', 'crazygames', 'poki')]
  [string]$Build = 'base',
  [int]$Port = 8000
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$dir  = if ($Build -eq 'base') { $root } else { Join-Path $root "builds\$Build" }

if (-not (Test-Path $dir)) {
  throw "No such build: $dir  (run .\tools\build-platforms.ps1 first)"
}

Write-Host "Serving $Build from $dir on http://localhost:$Port" -ForegroundColor Cyan
Write-Host "Ctrl+C to stop.`n"

Start-Process "http://localhost:$Port"
python -m http.server $Port --directory $dir

param(
  [string]$CsvPath = "C:\Users\FADLHA SULTHAN\Downloads\Telegram Desktop\WIP Dashboard per 21 July 18.28_cleaned.csv"
)

$ErrorActionPreference = 'Stop'
$node = "C:\Users\FADLHA SULTHAN\AppData\Local\Programs\cursor\resources\app\resources\helpers\node.exe"
if (-not (Test-Path $node)) {
  $node = (Get-Command node -ErrorAction SilentlyContinue).Source
}
if (-not $node) { throw "Node.js tidak ditemukan. Install Node.js atau jalankan dari Cursor." }

$script = Join-Path $PSScriptRoot "process-data.js"
& $node $script $CsvPath

$publicDir = Join-Path $PSScriptRoot "..\public"
if (-not (Test-Path $publicDir)) { New-Item -ItemType Directory -Path $publicDir | Out-Null }
Copy-Item $CsvPath (Join-Path $publicDir "cleaned_data.csv") -Force
Write-Host "Copied CSV to public/cleaned_data.csv"

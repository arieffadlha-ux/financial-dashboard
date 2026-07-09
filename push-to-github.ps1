# Push perubahan ke https://github.com/arieffadlha-ux/financial-dashboard
# Jalankan setelah Git terinstall. Buka PowerShell di folder ini lalu:
#   powershell -ExecutionPolicy Bypass -File .\push-to-github.ps1

$ErrorActionPreference = 'Stop'
$repo = "https://github.com/arieffadlha-ux/financial-dashboard.git"

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  Write-Host "Git belum terinstall." -ForegroundColor Red
  Write-Host "Install dari: https://git-scm.com/download/win"
  Write-Host "Atau jalankan: winget install Git.Git"
  exit 1
}

Set-Location $PSScriptRoot

if (-not (Test-Path .git)) {
  git init
  git branch -M main
}

$remote = git remote get-url origin 2>$null
if (-not $remote) {
  git remote add origin $repo
} elseif ($remote -ne $repo) {
  git remote set-url origin $repo
}

git add scripts/process-data.js scripts/generate-data.ps1 src/dataProcessor.js src/Dashboard.jsx src/data.js .gitignore
git status

$status = git status --porcelain
if (-not $status) {
  Write-Host "Tidak ada perubahan untuk di-commit." -ForegroundColor Yellow
  exit 0
}

git commit -m "Apply ADJ EBITDA from Dashboard sub-segment with updated CSV data"

Write-Host "`nMenarik perubahan dari GitHub (jika ada)..." -ForegroundColor Cyan
git pull origin main --rebase 2>$null
if ($LASTEXITCODE -ne 0) {
  Write-Host "Pull gagal (repo mungkin kosong di lokal). Lanjut push..." -ForegroundColor Yellow
}

Write-Host "Push ke GitHub..." -ForegroundColor Cyan
git push -u origin main

if ($LASTEXITCODE -eq 0) {
  Write-Host "`nBerhasil push ke GitHub!" -ForegroundColor Green
  Write-Host "Vercel akan otomatis re-deploy dalam 1-2 menit."
} else {
  Write-Host "`nPush gagal. Kemungkinan perlu login GitHub." -ForegroundColor Red
  Write-Host "Coba: git push -u origin main"
  Write-Host "Login akan muncul di browser (Git Credential Manager)."
}

#Requires -Version 5.1
<#
    One-command build for the Oryares Engine Predictive Maintenance desktop app.

    Produces a Windows NSIS installer in desktop\release\.

    Usage (from the project root):
        powershell -ExecutionPolicy Bypass -File .\build.ps1
#>
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot

$venvPython = Join-Path $root 'backend\.venv\Scripts\python.exe'
$pyinstaller = Join-Path $root 'backend\.venv\Scripts\pyinstaller.exe'

function Assert-PathExists([string]$path, [string]$hint) {
    if (-not (Test-Path -LiteralPath $path)) {
        throw "Missing '$path'. $hint"
    }
}

Assert-PathExists $venvPython "Create the backend venv first: python -m venv backend\.venv; backend\.venv\Scripts\pip install -r backend\requirements.txt pyinstaller"

function Install-IfNeeded([string]$dir) {
    if (-not (Test-Path -LiteralPath (Join-Path $dir 'node_modules'))) {
        Write-Host "   installing npm dependencies in $dir ..." -ForegroundColor DarkGray
        Push-Location $dir
        try { npm install } finally { Pop-Location }
    }
}

Write-Host '==> [1/4] Building frontend (Vite)' -ForegroundColor Cyan
Install-IfNeeded (Join-Path $root 'frontend')
Push-Location (Join-Path $root 'frontend')
try { npm run build } finally { Pop-Location }

Write-Host '==> [2/4] Generating application icon' -ForegroundColor Cyan
& $venvPython (Join-Path $root 'desktop\make_icon.py')

Write-Host '==> [3/4] Packaging backend (PyInstaller)' -ForegroundColor Cyan
Push-Location (Join-Path $root 'backend')
try { & $pyinstaller --clean --noconfirm backend.spec } finally { Pop-Location }

Write-Host '==> [4/4] Building Windows installer (electron-builder)' -ForegroundColor Cyan
Install-IfNeeded (Join-Path $root 'desktop')
Push-Location (Join-Path $root 'desktop')
try { npm run dist } finally { Pop-Location }

Write-Host ''
Write-Host 'Build complete. Installer(s):' -ForegroundColor Green
Get-ChildItem -Path (Join-Path $root 'desktop\release') -Filter '*.exe' -ErrorAction SilentlyContinue |
    ForEach-Object { Write-Host "   $($_.FullName)" }

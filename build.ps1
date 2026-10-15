#Requires -Version 5.1
<#
    One-command build for the Oryares Engine Predictive Maintenance desktop app.

    Produces a Windows NSIS installer in desktop\release\.

    Usage (from the project root):
        powershell -ExecutionPolicy Bypass -File .\build.ps1
#>
param(
    # Single source of truth for the web frontend. Override with -FrontendSource
    # if the frontend is developed in a different checkout.
    [string]$FrontendSource = (Join-Path $env:USERPROFILE 'Desktop\Engine simulation\React version v1.0\frontend')
)

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

# Mirror the frontend source of truth into this project so the desktop build
# never ships a stale copy. src/ and public/ are synced exactly (stale files
# removed); the root config files are copied over.
function Sync-Frontend([string]$src, [string]$dest) {
    if (-not (Test-Path -LiteralPath $src)) {
        Write-Host "   frontend source not found at '$src' - using existing copy in $dest" -ForegroundColor Yellow
        return
    }
    Write-Host "   syncing frontend from $src" -ForegroundColor DarkGray
    foreach ($sub in 'src', 'public') {
        $s = Join-Path $src $sub
        if (Test-Path -LiteralPath $s) {
            robocopy $s (Join-Path $dest $sub) /MIR /NFL /NDL /NJH /NJS /NP | Out-Null
            if ($LASTEXITCODE -ge 8) { throw "robocopy failed for '$sub' (exit $LASTEXITCODE)" }
        }
    }
    foreach ($f in 'index.html', 'vite.config.ts', 'package.json', 'tsconfig.json', 'tsconfig.app.json', 'tsconfig.node.json', '.oxlintrc.json') {
        $sf = Join-Path $src $f
        if (Test-Path -LiteralPath $sf) { Copy-Item -LiteralPath $sf -Destination (Join-Path $dest $f) -Force }
    }
}

Write-Host '==> [1/5] Syncing frontend from source' -ForegroundColor Cyan
Sync-Frontend $FrontendSource (Join-Path $root 'frontend')

Write-Host '==> [2/5] Building frontend (Vite)' -ForegroundColor Cyan
Install-IfNeeded (Join-Path $root 'frontend')
Push-Location (Join-Path $root 'frontend')
try { npm run build } finally { Pop-Location }

Write-Host '==> [3/5] Generating application icon' -ForegroundColor Cyan
& $venvPython (Join-Path $root 'desktop\make_icon.py')

Write-Host '==> [4/5] Packaging backend (PyInstaller)' -ForegroundColor Cyan
Push-Location (Join-Path $root 'backend')
try { & $pyinstaller --clean --noconfirm backend.spec } finally { Pop-Location }

Write-Host '==> [5/5] Building Windows installer (electron-builder)' -ForegroundColor Cyan
Install-IfNeeded (Join-Path $root 'desktop')
Push-Location (Join-Path $root 'desktop')
try { npm run dist } finally { Pop-Location }

Write-Host ''
Write-Host 'Build complete. Installer(s):' -ForegroundColor Green
Get-ChildItem -Path (Join-Path $root 'desktop\release') -Filter '*.exe' -ErrorAction SilentlyContinue |
    ForEach-Object { Write-Host "   $($_.FullName)" }

# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller recipe for the Oryares Engine backend (onedir build).

Bundles:
  * desktop_entry.py (uvicorn launcher)
  * xgboost_rul_model.pkl            -> <bundle>/xgboost_rul_model.pkl
  * ../frontend/dist                 -> <bundle>/frontend_dist  (served SPA)
  * native libs + hidden imports for xgboost / uvicorn / fpdf2

Run from the backend venv:
    pyinstaller --clean --noconfirm backend.spec
"""

from pathlib import Path

from PyInstaller.utils.hooks import collect_all

spec_dir = Path(SPECPATH).resolve()
project_root = spec_dir.parent

datas = [
    (str(spec_dir / "xgboost_rul_model.pkl"), "."),
    (str(project_root / "frontend" / "dist"), "frontend_dist"),
]
binaries = []
hiddenimports = []

# xgboost ships native DLLs; fpdf2 ships font data; uvicorn loads protocol
# implementations dynamically and would otherwise be missed by static analysis.
for package in ("xgboost", "fpdf", "uvicorn"):
    pkg_datas, pkg_binaries, pkg_hidden = collect_all(package)
    datas += pkg_datas
    binaries += pkg_binaries
    hiddenimports += pkg_hidden

hiddenimports += [
    "uvicorn.loops.auto",
    "uvicorn.protocols.http.auto",
    "uvicorn.protocols.websockets.auto",
    "uvicorn.lifespan.on",
]

a = Analysis(
    ["desktop_entry.py"],
    pathex=[str(spec_dir)],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=["tkinter", "matplotlib", "pytest"],
    noarchive=False,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="oryares-backend",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name="oryares-backend",
)

#!/usr/bin/env python3
"""Set up and launch Spine-Contour in development mode on any desktop OS."""

from __future__ import annotations

import hashlib
import os
from pathlib import Path
import shutil
import subprocess
import sys


ROOT = Path(__file__).resolve().parent
VENV = ROOT / ".venv"
REQUIREMENTS = ROOT / "backend" / "requirements.txt"
MARKER = VENV / ".spine-contour-requirements.sha256"


def run(command: list[str]) -> None:
    print(f"$ {' '.join(command)}", flush=True)
    subprocess.run(command, cwd=ROOT, check=True)


def venv_python() -> Path:
    if os.name == "nt":
        return VENV / "Scripts" / "python.exe"
    return VENV / "bin" / "python"


def ensure_python_environment() -> Path:
    python = venv_python()
    if not python.exists():
        print("Creating the local Python environment…", flush=True)
        run([sys.executable, "-m", "venv", str(VENV)])

    requirements_hash = hashlib.sha256(REQUIREMENTS.read_bytes()).hexdigest()
    installed_hash = MARKER.read_text().strip() if MARKER.exists() else ""
    if installed_hash != requirements_hash:
        print("Installing backend dependencies…", flush=True)
        run([str(python), "-m", "pip", "install", "--upgrade", "pip"])
        run([str(python), "-m", "pip", "install", "-r", str(REQUIREMENTS)])
        MARKER.write_text(requirements_hash + "\n")
    return python


def ensure_electron() -> str:
    npm = shutil.which("npm")
    if not npm:
        raise SystemExit("Node.js/npm is required. Install Node.js, then run this script again.")
    if not (ROOT / "node_modules" / "electron").exists():
        print("Installing Electron dependencies…", flush=True)
        run([npm, "install", "--no-save", "--no-package-lock", "--no-audit", "--no-fund"])
    return npm


def main() -> None:
    if sys.version_info < (3, 10):
        raise SystemExit("Python 3.10 or newer is required.")
    python = ensure_python_environment()
    npm = ensure_electron()
    environment = os.environ.copy()
    environment["SPINE_CONTOUR_PYTHON"] = str(python)
    print("Launching Spine-Contour in development mode…", flush=True)
    subprocess.run([npm, "run", "dev"], cwd=ROOT, env=environment, check=True)


if __name__ == "__main__":
    main()

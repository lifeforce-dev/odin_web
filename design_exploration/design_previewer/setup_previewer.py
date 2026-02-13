from __future__ import annotations

import argparse
import importlib
import os
import subprocess
import sys
import webbrowser
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


def get_venv_python(script_dir: Path) -> Path:
    if os.name == "nt":
        return script_dir / ".venv" / "Scripts" / "python.exe"

    return script_dir / ".venv" / "bin" / "python"


def run_command(command: list[str], error_message: str) -> None:
    result = subprocess.run(command, check=False)
    if result.returncode != 0:
        raise RuntimeError(error_message)


def ensure_pip(venv_python: Path) -> None:
    pip_check = subprocess.run([str(venv_python), "-m", "pip", "--version"], check=False)
    if pip_check.returncode == 0:
        return

    run_command(
        [str(venv_python), "-m", "ensurepip", "--upgrade"],
        "Failed to bootstrap pip in previewer .venv.",
    )


def ensure_dependencies(script_dir: Path, skip_install: bool) -> None:
    try:
        importlib.import_module("pydantic")
        return
    except ModuleNotFoundError:
        if skip_install:
            raise RuntimeError("pydantic is not installed. Re-run without --skip-install.")

    venv_python = get_venv_python(script_dir)
    if not venv_python.exists():
        run_command(
            [sys.executable, "-m", "venv", str(script_dir / ".venv")],
            "Failed to create previewer .venv.",
        )

    ensure_pip(venv_python)

    run_command(
        [str(venv_python), "-m", "pip", "install", "pydantic>=2,<3"],
        "Failed to install previewer dependencies.",
    )

    current_python = Path(sys.executable).resolve()
    target_python = venv_python.resolve()
    if current_python == target_python:
        return

    forwarded_args = list(sys.argv[1:])
    if "--skip-install" not in forwarded_args:
        forwarded_args.append("--skip-install")

    rerun = subprocess.run([str(venv_python), str(Path(__file__).resolve()), *forwarded_args], check=False)
    raise SystemExit(rerun.returncode)


def run_server(root_path: Path, host: str, port: int, auto_open: bool) -> None:
    handler = partial(SimpleHTTPRequestHandler, directory=str(root_path))
    server = ThreadingHTTPServer((host, port), handler)
    url = f"http://{host}:{port}/index.html"

    print(f"Serving previewer at {url}")
    if auto_open:
        webbrowser.open(url)

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


def main() -> int:
    script_dir = Path(__file__).resolve().parent
    default_root = script_dir.parent

    parser = argparse.ArgumentParser(description="Bootstrap and run design previewer.")
    parser.add_argument("--root", type=Path, default=default_root, help="Root folder to discover designs from.")
    parser.add_argument("--manifest", type=Path, default=script_dir / "manifest.json", help="Output manifest path.")
    parser.add_argument("--title", default="Design Previewer", help="Manifest title shown in UI.")
    parser.add_argument("--description", default="Auto-discovered design preview manifest.", help="Manifest description shown in UI.")
    parser.add_argument("--skip-install", action="store_true", help="Do not auto-install missing dependencies.")
    parser.add_argument("--serve", action="store_true", help="Run a local HTTP preview server after generating manifest.")
    parser.add_argument("--open", action="store_true", help="Open browser automatically when serving.")
    parser.add_argument("--host", default="127.0.0.1", help="Host for --serve mode.")
    parser.add_argument("--port", type=int, default=8123, help="Port for --serve mode.")

    args = parser.parse_args()

    ensure_dependencies(script_dir, args.skip_install)

    from previewer_manifest import build_manifest

    root_path = args.root.resolve()
    manifest_path = args.manifest.resolve()

    manifest = build_manifest(root_path, args.title, args.description)
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(manifest.model_dump_json(indent=2) + "\n", encoding="utf-8")

    print(f"Manifest written: {manifest_path}")
    print(f"Versions discovered: {len(manifest.versions)}")

    if args.serve:
        run_server(root_path, args.host, args.port, args.open)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

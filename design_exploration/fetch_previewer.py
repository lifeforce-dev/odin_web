from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.request
import zipfile
from pathlib import Path
from typing import Any, cast


TAG_PATTERN = re.compile(r"^dev-(\d+)\.(\d+)\.(\d+)$")
TAG_STATE_FILE = ".design_previewer_tag.json"
DEFAULT_PREVIEWER_REPO = "lifeforce-dev/design_previewer"


def parse_dev_tag(tag_name: str) -> tuple[int, int, int] | None:
    match = TAG_PATTERN.match(tag_name)
    if not match:
        return None

    return int(match.group(1)), int(match.group(2)), int(match.group(3))


def github_json(url: str) -> Any:
    request = urllib.request.Request(
        url,
        headers={
            "Accept": "application/vnd.github+json",
            "User-Agent": "design-previewer-bootstrap",
        },
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.loads(response.read().decode("utf-8"))


def fetch_latest_tag(repo: str) -> str:
    payload_raw = github_json(f"https://api.github.com/repos/{repo}/tags?per_page=100")
    if not isinstance(payload_raw, list):
        raise RuntimeError(f"Unexpected tags response for repository '{repo}'.")

    payload_list = cast(list[Any], payload_raw)
    payload: list[dict[str, Any]] = []
    for item in payload_list:
        if isinstance(item, dict):
            payload.append(cast(dict[str, Any], item))

    if not payload:
        raise RuntimeError(f"No tags found for repository '{repo}'.")

    tag_names: list[str] = []
    for item in payload:
        name = item.get("name")
        if isinstance(name, str) and name:
            tag_names.append(name)

    parsed = [(name, parse_dev_tag(name)) for name in tag_names]
    dev_tags = [(name, version) for name, version in parsed if version is not None]

    if dev_tags:
        return max(dev_tags, key=lambda entry: entry[1])[0]

    return tag_names[0]


def repo_folder_name(repo: str) -> str:
    folder = repo.strip().split("/")[-1]
    if folder.lower().endswith(".git"):
        folder = folder[:-4]

    return folder


def read_installed_tag(target_dir: Path) -> str | None:
    state_path = target_dir / TAG_STATE_FILE
    if not state_path.exists():
        return None

    try:
        payload = json.loads(state_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return None

    payload_dict = cast(dict[str, Any], payload) if isinstance(payload, dict) else {}
    tag_name = payload_dict.get("tag")
    return tag_name if isinstance(tag_name, str) and tag_name else None


def write_installed_tag(target_dir: Path, repo: str, tag: str) -> None:
    state_path = target_dir / TAG_STATE_FILE
    state_path.write_text(
        json.dumps({"repo": repo, "tag": tag}, indent=2) + "\n",
        encoding="utf-8",
    )


def download_tag_to(repo: str, tag: str, target_dir: Path) -> None:
    archive_url = f"https://codeload.github.com/{repo}/zip/refs/tags/{tag}"
    with tempfile.TemporaryDirectory() as temp_dir_str:
        temp_dir = Path(temp_dir_str)
        archive_path = temp_dir / f"{tag}.zip"
        urllib.request.urlretrieve(archive_url, archive_path)

        with zipfile.ZipFile(archive_path) as archive:
            archive.extractall(temp_dir)

        extracted_dirs = [path for path in temp_dir.iterdir() if path.is_dir()]
        if not extracted_dirs:
            raise RuntimeError(f"Downloaded release '{tag}' from '{repo}' did not contain files.")

        source_dir = extracted_dirs[0]
        if target_dir.exists():
            shutil.rmtree(target_dir)

        shutil.move(str(source_dir), str(target_dir))


def ensure_previewer_checkout(script_dir: Path, repo: str, tag: str) -> Path:
    target_dir = script_dir / repo_folder_name(repo)
    current_tag = read_installed_tag(target_dir)
    core_script = target_dir / "setup_previewer.py"

    if current_tag == tag and core_script.exists():
        return target_dir

    download_tag_to(repo, tag, target_dir)
    write_installed_tag(target_dir, repo, tag)

    if not core_script.exists():
        raise RuntimeError(f"Release '{tag}' from '{repo}' is missing setup_previewer.py.")

    return target_dir


def get_venv_python(previewer_dir: Path) -> Path:
    if os.name == "nt":
        return previewer_dir / ".venv" / "Scripts" / "python.exe"

    return previewer_dir / ".venv" / "bin" / "python"


def get_venv_scripts_dir(previewer_dir: Path) -> Path:
    if os.name == "nt":
        return previewer_dir / ".venv" / "Scripts"

    return previewer_dir / ".venv" / "bin"


def ensure_runtime_environment(previewer_dir: Path) -> None:
    venv_python = get_venv_python(previewer_dir)

    if not venv_python.exists():
        create_venv = [sys.executable, "-m", "venv", str(previewer_dir / ".venv")]
        create_result = subprocess.run(create_venv, check=False)
        if create_result.returncode != 0:
            raise RuntimeError("Failed to create runtime venv for design_previewer.")

    venv_scripts_dir = get_venv_scripts_dir(previewer_dir)
    env = os.environ.copy()
    env["VIRTUAL_ENV"] = str(previewer_dir / ".venv")
    env["PATH"] = str(venv_scripts_dir) + os.pathsep + env.get("PATH", "")

    command = ["python", "-m", "pip", "install", "-e", str(previewer_dir)]
    result = subprocess.run(command, check=False, env=env)
    if result.returncode != 0:
        raise RuntimeError("Failed to install design_previewer runtime from pyproject.toml.")


def print_next_step(script_dir: Path, previewer_dir: Path) -> None:
    print()
    print("Fetch complete. Run these 3 commands:")
    print()
    print(f'  1.  cd "{script_dir}"')
    if os.name == "nt":
        print("  2.  .\\design_previewer\\.venv\\Scripts\\Activate.ps1")
        print("  3.  python design_previewer/setup_previewer.py --serve --open")
    else:
        print("  2.  source ./design_previewer/.venv/bin/activate")
        print("  3.  python3 design_previewer/setup_previewer.py --serve --open")


def main() -> int:
    parser = argparse.ArgumentParser(description="Fetch and run design_previewer release from tags.")
    parser.add_argument(
        "--previewer-repo",
        default=os.environ.get("DESIGN_PREVIEWER_REPO", DEFAULT_PREVIEWER_REPO),
        help="Public GitHub repo slug. Defaults to lifeforce-dev/design_previewer.",
    )
    parser.add_argument(
        "--previewer-tag",
        default=os.environ.get("DESIGN_PREVIEWER_TAG", ""),
        help="Optional explicit tag. If omitted, latest dev-* tag is used.",
    )
    args = parser.parse_args()

    repo = args.previewer_repo.strip() or DEFAULT_PREVIEWER_REPO

    tag = args.previewer_tag.strip() or fetch_latest_tag(repo)
    script_dir = Path(__file__).resolve().parent

    previewer_dir = ensure_previewer_checkout(script_dir, repo, tag)
    print(f"Using design_previewer: {repo}@{tag} -> {previewer_dir}")

    ensure_runtime_environment(previewer_dir)

    print_next_step(script_dir, previewer_dir)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
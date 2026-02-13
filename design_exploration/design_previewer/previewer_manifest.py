from __future__ import annotations

import re
from datetime import datetime
from pathlib import Path

from pydantic import BaseModel, Field


SPECIAL_WORDS = {
    "gpt": "GPT",
    "claude": "Claude",
    "gemini": "Gemini",
    "rts": "RTS",
    "hud": "HUD",
    "hq": "HQ",
}


class DesignItem(BaseModel):
    title: str
    path: str


class DesignGroup(BaseModel):
    key: str
    label: str
    items: list[DesignItem] = Field(default_factory=list)


class DesignVersion(BaseModel):
    key: str
    label: str
    groups: list[DesignGroup] = Field(default_factory=list)


class DesignManifest(BaseModel):
    title: str
    description: str
    generatedAt: str
    rootPath: str
    versions: list[DesignVersion] = Field(default_factory=list)


def title_words(value: str) -> str:
    if not value.strip():
        return value

    parts = [part for part in re.split(r"[-_]+", value) if part]
    if not parts:
        return value

    converted: list[str] = []
    for part in parts:
        lower = part.lower()
        if lower.isdigit():
            converted.append(part)
            continue

        converted.append(SPECIAL_WORDS.get(lower, lower.capitalize()))

    return " ".join(converted)


def file_title(file_name: str) -> str:
    stem = Path(file_name).stem

    match = re.match(r"^design-(\d+)-(.*)$", stem)
    if match:
        return f"{match.group(1)} - {title_words(match.group(2))}"

    match = re.match(r"^(\d+)-(.*)$", stem)
    if match:
        return f"{match.group(1)} - {title_words(match.group(2))}"

    return title_words(stem)


def group_label(folder_name: str) -> str:
    match = re.match(r"^designs[_\- ]?(.*)$", folder_name, flags=re.IGNORECASE)
    if match:
        suffix = match.group(1).strip()
        if suffix:
            return title_words(suffix)

    return title_words(folder_name)


def rel_path(base_path: Path, target_path: Path) -> str:
    try:
        relative = target_path.relative_to(base_path)
    except ValueError:
        relative = Path(Path.cwd(), target_path).resolve().relative_to(base_path)

    return f"./{relative.as_posix()}"


def build_group(group_dir: Path, base_path: Path) -> DesignGroup | None:
    html_files = sorted(
        [path for path in group_dir.glob("*.html") if path.name.lower() != "index.html"],
        key=lambda path: path.name.lower(),
    )

    if not html_files:
        return None

    items = [
        DesignItem(
            title=file_title(path.name),
            path=rel_path(base_path, path),
        )
        for path in html_files
    ]

    return DesignGroup(
        key=group_dir.name,
        label=group_label(group_dir.name),
        items=items,
    )


def discover_versions(root_path: Path) -> list[DesignVersion]:
    version_dirs = sorted(
        [path for path in root_path.iterdir() if path.is_dir() and re.match(r"^v\d+$", path.name, re.IGNORECASE)],
        key=lambda path: path.name.lower(),
    )

    versions: list[DesignVersion] = []

    if version_dirs:
        for version_dir in version_dirs:
            groups: list[DesignGroup] = []
            for group_dir in sorted([path for path in version_dir.iterdir() if path.is_dir()], key=lambda path: path.name.lower()):
                group = build_group(group_dir, root_path)
                if group:
                    groups.append(group)

            if groups:
                versions.append(
                    DesignVersion(
                        key=version_dir.name.lower(),
                        label=version_dir.name.upper(),
                        groups=groups,
                    )
                )

        return versions

    groups: list[DesignGroup] = []
    for group_dir in sorted(
        [path for path in root_path.iterdir() if path.is_dir() and path.name.lower().startswith("designs")],
        key=lambda path: path.name.lower(),
    ):
        group = build_group(group_dir, root_path)
        if group:
            groups.append(group)

    if groups:
        versions.append(DesignVersion(key="v1", label="V1", groups=groups))

    return versions


def build_manifest(root_path: Path, title: str, description: str) -> DesignManifest:
    return DesignManifest(
        title=title,
        description=description,
        generatedAt=datetime.now().astimezone().isoformat(timespec="seconds"),
        rootPath=str(root_path),
        versions=discover_versions(root_path),
    )

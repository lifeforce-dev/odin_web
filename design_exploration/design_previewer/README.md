# Design Previewer Setup

This previewer uses a generated manifest.json to discover versions, groups, and design files.

## Requirements

- Python 3.9+
- pydantic (auto-installed by the setup script)

## One command bootstrap

Just get it running:

python setup_previewer.py --serve --open

From this folder:

python setup_previewer.py --title "Odin Design Previewer" --description "Auto-discovered from v* and design folders."

From anywhere:

python e:/source/odin_web/design_exploration/design_previewer/setup_previewer.py --title "Odin Design Previewer" --description "Auto-discovered from v* and design folders."

The script will:

1. Install missing dependencies with pip install -e . (using pyproject.toml).
2. Discover versions, groups, and design html files.
3. Generate manifest.json.

## Optional preview server

python setup_previewer.py --serve --open

This serves index.html locally and opens it in your browser.

#!/usr/bin/env bash
# Regenerate OS / Tauri icons from repo-root logo.svg
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "${ROOT}"

python3 <<'PY'
from pathlib import Path
logo = Path("logo.svg").read_text()
sq = logo.replace(
    'width="628" height="643" viewBox="0 0 628 643"',
    'width="1024" height="1024" viewBox="0 0 643 643"',
    1,
)
sq = sq.replace(
    '<rect width="628" height="643" rx="96" ry="96" fill="#1d2730"/>',
    '<rect width="643" height="643" rx="96" ry="96" fill="#1d2730"/><g transform="translate(7.5 0)">',
    1,
)
sq = sq.rstrip()
if sq.endswith("</svg>"):
    sq = sq[:-6] + "</g>\n</svg>\n"
Path("src-tauri/icons/icon.svg").write_text(sq)
Path("public/logo.svg").write_text(logo)
Path("public/vortex.svg").write_text(logo)
print("synced public/logo.svg, public/vortex.svg, src-tauri/icons/icon.svg")
PY

rsvg-convert -w 1024 -h 1024 src-tauri/icons/icon.svg -o /tmp/vortex-app-icon.png
npx tauri icon /tmp/vortex-app-icon.png -o src-tauri/icons

# Restore vector source (tauri icon may overwrite icon.svg)
python3 <<'PY'
from pathlib import Path
logo = Path("logo.svg").read_text()
sq = logo.replace(
    'width="628" height="643" viewBox="0 0 628 643"',
    'width="1024" height="1024" viewBox="0 0 643 643"',
    1,
)
sq = sq.replace(
    '<rect width="628" height="643" rx="96" ry="96" fill="#1d2730"/>',
    '<rect width="643" height="643" rx="96" ry="96" fill="#1d2730"/><g transform="translate(7.5 0)">',
    1,
)
sq = sq.rstrip()
if sq.endswith("</svg>"):
    sq = sq[:-6] + "</g>\n</svg>\n"
Path("src-tauri/icons/icon.svg").write_text(sq)
PY

echo "done — app icons regenerated from logo.svg"

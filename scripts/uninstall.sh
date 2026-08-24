#!/usr/bin/env bash
# Remove a Vortex GUI install performed by scripts/install.sh (user-local).
set -euo pipefail

os="$(uname -s | tr '[:upper:]' '[:lower:]')"

remove_linux() {
  local dir="${VORTEX_GUI_DIR:-${HOME}/.local}"
  rm -f "${dir}/bin/VortexGUI.AppImage"
  rm -f "${dir}/share/applications/vortex-gui.desktop"
  rm -f "${dir}/share/icons/hicolor/256x256/apps/vortex-gui.png"
  rm -f "${dir}/share/icons/hicolor/scalable/apps/vortex-gui.svg"
  echo "removed user-local AppImage install under ${dir}"
  if command -v dpkg >/dev/null 2>&1 && dpkg -l vortex-gui >/dev/null 2>&1; then
    echo "note: .deb package still installed — run: sudo apt remove vortex-gui"
  fi
}

remove_macos() {
  local dest_root="${VORTEX_GUI_DIR:-${HOME}/Applications}"
  local removed=0
  for app in "${dest_root}/Vortex GUI.app" "${dest_root}/VortexGUI.app"; do
    if [[ -d "${app}" ]]; then
      rm -rf "${app}"
      echo "removed ${app}"
      removed=1
    fi
  done
  if [[ "${removed}" -eq 0 ]]; then
    echo "no Vortex GUI.app found under ${dest_root}"
  fi
}

case "${os}" in
  linux) remove_linux ;;
  darwin) remove_macos ;;
  *)
    echo "unsupported OS: ${os}" >&2
    exit 1
    ;;
esac

echo "config/data left intact: ~/.config/vortex-gui/ (delete manually if desired)"

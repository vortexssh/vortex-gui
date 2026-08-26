#!/usr/bin/env bash
# Remove bundled libwayland from a Tauri AppImage (Mesa 25+ / CachyOS EGL crash).
# Usage: scripts/appimage-unbundle-wayland.sh path/to/AppImage [more...]
set -euo pipefail
shopt -s nullglob

APPIMAGES=("$@")
if [[ ${#APPIMAGES[@]} -eq 0 ]]; then
  APPIMAGES=(src-tauri/target/release/bundle/appimage/*.AppImage)
fi

if [[ ${#APPIMAGES[@]} -eq 0 ]]; then
  echo "error: no AppImage path given and none found under src-tauri/target/release/bundle/appimage/" >&2
  exit 1
fi

ARCH="$(uname -m)"
case "${ARCH}" in
  x86_64) APPIMAGE_ARCH="x86_64" ;;
  aarch64) APPIMAGE_ARCH="aarch64" ;;
  *)
    echo "error: unsupported arch for repack: ${ARCH}" >&2
    exit 1
    ;;
esac

TOOL_CACHE="${XDG_CACHE_HOME:-${HOME}/.cache}/vortex-gui-appimagetool"
mkdir -p "${TOOL_CACHE}"
APPIMAGETOOL="${TOOL_CACHE}/appimagetool-${APPIMAGE_ARCH}.AppImage"
if [[ ! -x "${APPIMAGETOOL}" ]]; then
  echo "↓ appimagetool (${APPIMAGE_ARCH})"
  curl -fsSL \
    "https://github.com/AppImage/AppImageKit/releases/download/continuous/appimagetool-${APPIMAGE_ARCH}.AppImage" \
    -o "${APPIMAGETOOL}"
  chmod +x "${APPIMAGETOOL}"
fi

for appimage in "${APPIMAGES[@]}"; do
  [[ -f "${appimage}" ]] || {
    echo "error: not a file: ${appimage}" >&2
    exit 1
  }
  echo "unbundle wayland: ${appimage}"
  work="$(mktemp -d)"
  cleanup() { rm -rf "${work}"; }
  trap cleanup EXIT

  cp -f "${appimage}" "${work}/input.AppImage"
  chmod +x "${work}/input.AppImage"
  (cd "${work}" && ./input.AppImage --appimage-extract >/dev/null)

  removed=0
  while IFS= read -r -d '' lib; do
    rm -f "${lib}"
    removed=1
  done < <(find "${work}/squashfs-root" -name 'libwayland-*.so*' -print0 2>/dev/null)

  if [[ "${removed}" -eq 0 ]]; then
    echo "  no bundled libwayland found — left unchanged"
    trap - EXIT
    cleanup
    continue
  fi

  out="${work}/repacked.AppImage"
  ARCH="${APPIMAGE_ARCH}" "${APPIMAGETOOL}" "${work}/squashfs-root" "${out}" >/dev/null
  install -m 755 "${out}" "${appimage}"
  echo "  repacked → ${appimage}"

  trap - EXIT
  cleanup
done

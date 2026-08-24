#!/usr/bin/env bash
# Vortex GUI installer (Linux + macOS).
#
#   curl -fsSL https://raw.githubusercontent.com/vortexssh/vortex-gui/master/scripts/install.sh | bash
#   curl -fsSL https://vortex.timant32.ru/gui/install.sh | bash
#
# Env:
#   VORTEX_GUI_VERSION        tag without leading v, or "latest" (default)
#   VORTEX_GUI_REPO           owner/name (default: vortexssh/vortex-gui)
#   VORTEX_GUI_DIR            install root
#   VORTEX_GUI_GITHUB_TOKEN   optional — private releases
#   VORTEX_GUI_PREFERRED      deb|appimage (Linux; default appimage)
set -euo pipefail

REPO="${VORTEX_GUI_REPO:-vortexssh/vortex-gui}"
VERSION="${VORTEX_GUI_VERSION:-latest}"
PREFERRED_LINUX="${VORTEX_GUI_PREFERRED:-appimage}"
API_BASE="https://api.github.com/repos/${REPO}"

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "error: required command not found: $1" >&2
    exit 1
  }
}

need_cmd curl
need_cmd uname
need_cmd mktemp
need_cmd python3

os="$(uname -s | tr '[:upper:]' '[:lower:]')"
arch="$(uname -m)"
case "${arch}" in
  x86_64 | amd64) arch="x86_64" ;;
  aarch64 | arm64) arch="aarch64" ;;
  *)
    echo "error: unsupported architecture: ${arch}" >&2
    exit 1
    ;;
esac

auth_headers=()
if [[ -n "${VORTEX_GUI_GITHUB_TOKEN:-}" ]]; then
  auth_headers=(-H "Authorization: Bearer ${VORTEX_GUI_GITHUB_TOKEN}")
fi

fetch_release_json() {
  local url code body
  if [[ "${VERSION}" == "latest" ]]; then
    url="${API_BASE}/releases/latest"
  else
    url="${API_BASE}/releases/tags/v${VERSION#v}"
  fi
  body="$(mktemp)"
  code="$(curl -sS -o "${body}" -w '%{http_code}' "${auth_headers[@]}" \
    -H "Accept: application/vnd.github+json" \
    -H "X-GitHub-Api-Version: 2022-11-28" \
    "${url}" || true)"
  if [[ "${code}" != "200" ]]; then
    echo "error: GitHub release not found (HTTP ${code}) for ${REPO} @ ${VERSION}" >&2
    echo "  tried: ${url}" >&2
    if [[ "${code}" == "404" ]]; then
      echo "  No published release yet. Create one, then retry:" >&2
      echo "    git tag v0.1.0 && git push origin v0.1.0" >&2
      echo "  That triggers .github/workflows/release.yml (AppImage / dmg / NSIS)." >&2
      echo "  If the repo is private, set VORTEX_GUI_GITHUB_TOKEN." >&2
    fi
    rm -f "${body}"
    exit 1
  fi
  cat "${body}"
  rm -f "${body}"
}

# Prints: <download_url>\t<asset_name>
# Args: os arch preferred /path/to/release.json
pick_asset() {
  python3 - "$1" "$2" "$3" "$4" <<'PY'
import json, sys
os_name, arch, preferred, path = sys.argv[1:5]
with open(path, encoding="utf-8") as f:
    rel = json.load(f)
assets = rel.get("assets") or []

def name(a):
    return a.get("name") or ""

def url(a):
    return a.get("browser_download_url") or ""

cands = []
for a in assets:
    n = name(a).lower()
    u = url(a)
    if not u:
        continue
    if os_name == "linux":
        if arch == "x86_64" and ("aarch64" in n or "arm64" in n):
            continue
        if arch == "aarch64" and any(x in n for x in ("amd64", "x64", "x86_64")) and "aarch64" not in n and "arm64" not in n:
            continue
        if preferred == "deb" and n.endswith(".deb"):
            cands.append((0, u, name(a)))
        elif n.endswith(".appimage"):
            cands.append((1 if preferred == "deb" else 0, u, name(a)))
        elif n.endswith(".deb"):
            cands.append((2, u, name(a)))
    elif os_name == "darwin":
        if arch == "aarch64" and any(x in n for x in ("x64", "x86_64")) and "aarch64" not in n and "arm64" not in n:
            continue
        if arch == "x86_64" and ("aarch64" in n or "arm64" in n):
            continue
        if n.endswith(".dmg"):
            cands.append((0, u, name(a)))
        elif n.endswith(".app.tar.gz") or (n.endswith(".tar.gz") and "app" in n):
            cands.append((1, u, name(a)))

cands.sort(key=lambda t: t[0])
if not cands:
    print("error: no matching release asset for", os_name, arch, file=sys.stderr)
    names = ", ".join(name(a) for a in assets) or "(none)"
    print("available:", names, file=sys.stderr)
    sys.exit(1)
print(f"{cands[0][1]}\t{cands[0][2]}")
PY
}

download() {
  local url="$1" dest="$2"
  echo "↓ ${url}"
  curl -fL --progress-bar "${auth_headers[@]}" -o "${dest}" "${url}"
}

install_linux_appimage() {
  local src="$1"
  local dir="${VORTEX_GUI_DIR:-${HOME}/.local}"
  local bin_dir="${dir}/bin"
  local apps="${dir}/share/applications"
  local hicolor="${dir}/share/icons/hicolor"
  mkdir -p "${bin_dir}" "${apps}" \
    "${hicolor}/32x32/apps" \
    "${hicolor}/64x64/apps" \
    "${hicolor}/128x128/apps" \
    "${hicolor}/256x256/apps" \
    "${hicolor}/512x512/apps" \
    "${hicolor}/scalable/apps"

  local dest="${bin_dir}/VortexGUI.AppImage"
  install -m 755 "${src}" "${dest}"

  # PNGs in the matching size dirs (wrong-size dirs → GNOME shows a generic gear).
  local icon_png="${hicolor}/512x512/apps/vortex-gui.png"
  curl -fsSL "https://raw.githubusercontent.com/${REPO}/master/src-tauri/icons/icon.png" \
    -o "${icon_png}" || true
  curl -fsSL "https://raw.githubusercontent.com/${REPO}/master/src-tauri/icons/32x32.png" \
    -o "${hicolor}/32x32/apps/vortex-gui.png" 2>/dev/null || true
  curl -fsSL "https://raw.githubusercontent.com/${REPO}/master/src-tauri/icons/64x64.png" \
    -o "${hicolor}/64x64/apps/vortex-gui.png" 2>/dev/null || true
  curl -fsSL "https://raw.githubusercontent.com/${REPO}/master/src-tauri/icons/128x128.png" \
    -o "${hicolor}/128x128/apps/vortex-gui.png" 2>/dev/null || true
  # 256: scale from 512 when available
  if [[ -f "${icon_png}" ]] && command -v convert >/dev/null 2>&1; then
    convert "${icon_png}" -resize 256x256 "${hicolor}/256x256/apps/vortex-gui.png" 2>/dev/null || \
      cp -f "${icon_png}" "${hicolor}/256x256/apps/vortex-gui.png"
  elif [[ -f "${icon_png}" ]]; then
    cp -f "${icon_png}" "${hicolor}/256x256/apps/vortex-gui.png"
  fi
  curl -fsSL "https://raw.githubusercontent.com/${REPO}/master/logo.svg" \
    -o "${hicolor}/scalable/apps/vortex-gui.svg" 2>/dev/null || true

  # Absolute Icon= is what GNOME actually resolves for user .desktop files.
  local icon_ref="vortex-gui"
  if [[ -f "${icon_png}" ]]; then
    icon_ref="${icon_png}"
  elif [[ -f "${hicolor}/128x128/apps/vortex-gui.png" ]]; then
    icon_ref="${hicolor}/128x128/apps/vortex-gui.png"
  fi

  cat >"${apps}/vortex-gui.desktop" <<EOF
[Desktop Entry]
Name=Vortex GUI
Comment=Local-first VortexSSH desktop client
Exec=env WEBKIT_DISABLE_DMABUF_RENDERER=1 __NV_DISABLE_EXPLICIT_SYNC=1 ${dest}
Icon=${icon_ref}
Terminal=false
Type=Application
Categories=Network;Utility;
StartupWMClass=vortex-gui
EOF

  # Refresh caches so the grid picks it up immediately.
  if command -v update-desktop-database >/dev/null 2>&1; then
    update-desktop-database "${apps}" 2>/dev/null || true
  fi
  if command -v gtk-update-icon-cache >/dev/null 2>&1; then
    gtk-update-icon-cache -f -t "${hicolor}" 2>/dev/null || true
  fi
  if command -v xdg-desktop-menu >/dev/null 2>&1; then
    xdg-desktop-menu forceupdate 2>/dev/null || true
  fi

  echo "installed AppImage → ${dest}"
  echo "desktop entry → ${apps}/vortex-gui.desktop"
  echo "icon → ${icon_ref}"
  case ":${PATH}:" in
    *":${bin_dir}:"*) ;;
    *)
      echo "note: add ${bin_dir} to PATH (e.g. export PATH=\"${bin_dir}:\$PATH\")" >&2
      ;;
  esac
}

install_linux_deb() {
  local src="$1"
  if [[ "${EUID}" -ne 0 ]]; then
    echo "deb install needs root — re-run with sudo, or set VORTEX_GUI_PREFERRED=appimage" >&2
    exit 1
  fi
  if command -v apt-get >/dev/null 2>&1; then
    apt-get install -y "${src}"
  else
    dpkg -i "${src}" || true
  fi
  echo "installed .deb package"
}

install_macos() {
  local src="$1" name="$2"
  local dest_root="${VORTEX_GUI_DIR:-${HOME}/Applications}"
  mkdir -p "${dest_root}"
  local tmp
  tmp="$(mktemp -d)"
  cleanup() { rm -rf "${tmp}"; }
  trap cleanup EXIT

  if [[ "${name}" == *.dmg ]]; then
    local mount
    mount="$(hdiutil attach -nobrowse -readonly "${src}" | awk '/\/Volumes\//{print $NF; exit}')"
    if [[ -z "${mount}" ]]; then
      echo "error: failed to mount DMG" >&2
      exit 1
    fi
    local app
    app="$(find "${mount}" -maxdepth 2 -name '*.app' -print -quit)"
    if [[ -z "${app}" ]]; then
      hdiutil detach "${mount}" >/dev/null || true
      echo "error: .app not found in DMG" >&2
      exit 1
    fi
    local base
    base="$(basename "${app}")"
    rm -rf "${dest_root}/${base}"
    ditto "${app}" "${dest_root}/${base}"
    hdiutil detach "${mount}" >/dev/null || true
    echo "installed ${base} → ${dest_root}/${base}"
    echo "tip: first launch may need right-click → Open (unsigned builds)"
  else
    tar -xzf "${src}" -C "${tmp}"
    local app
    app="$(find "${tmp}" -maxdepth 3 -name '*.app' -print -quit)"
    if [[ -z "${app}" ]]; then
      echo "error: .app not found in archive" >&2
      exit 1
    fi
    local base
    base="$(basename "${app}")"
    rm -rf "${dest_root}/${base}"
    ditto "${app}" "${dest_root}/${base}"
    echo "installed ${base} → ${dest_root}/${base}"
  fi
  trap - EXIT
  cleanup
}

main() {
  echo "Vortex GUI installer"
  echo "  repo=${REPO}  version=${VERSION}  os=${os}  arch=${arch}"

  case "${os}" in
    linux | darwin) ;;
    *)
      echo "error: unsupported OS: ${os} (use install.ps1 on Windows)" >&2
      exit 1
      ;;
  esac

  local release_json line asset_url asset_name tmp
  release_json="$(mktemp)"
  fetch_release_json >"${release_json}"
  line="$(pick_asset "${os}" "${arch}" "${PREFERRED_LINUX}" "${release_json}")"
  rm -f "${release_json}"
  asset_url="${line%%$'\t'*}"
  asset_name="${line#*$'\t'}"
  echo "asset: ${asset_name}"

  tmp="$(mktemp)"
  download "${asset_url}" "${tmp}"

  case "${os}" in
    linux)
      if [[ "${asset_name}" == *.deb ]]; then
        install_linux_deb "${tmp}"
      else
        chmod +x "${tmp}"
        install_linux_appimage "${tmp}"
      fi
      ;;
    darwin)
      install_macos "${tmp}" "${asset_name}"
      ;;
  esac
  rm -f "${tmp}"
  echo "done."
}

main "$@"

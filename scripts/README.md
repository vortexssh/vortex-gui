# Install scripts

Curl-friendly installers for **Vortex GUI** release artifacts (GitHub Releases).

## Regenerating app icons

Source of truth: repo-root [`logo.svg`](../logo.svg).

```bash
./scripts/gen-icons.sh
```

This syncs `public/logo.svg` / `public/vortex.svg` and rebuilds `src-tauri/icons/*` (png/ico/icns) for Tauri.

## One-liners

**Linux / macOS**

```bash
curl -fsSL https://raw.githubusercontent.com/vortexssh/vortex-gui/master/scripts/install.sh | bash
```

Optional mirror (after you publish `scripts/install.sh` to the landing host):

```bash
curl -fsSL https://vortex.timant32.ru/gui/install.sh | bash
```

**Windows (PowerShell)**

```powershell
irm https://raw.githubusercontent.com/vortexssh/vortex-gui/master/scripts/install.ps1 | iex
```

## What gets installed

| OS | Default artifact | Location |
|---|---|---|
| Linux | AppImage | `~/.local/bin/VortexGUI.AppImage` + `.desktop` |
| Linux | `.deb` (opt-in) | system package via `apt`/`dpkg` (needs sudo) |
| macOS | `.dmg` / `.app.tar.gz` | `~/Applications/Vortex GUI.app` |
| Windows | NSIS `.exe` (or MSI) | Start Menu / per-user install |

## Environment

| Variable | Meaning |
|---|---|
| `VORTEX_GUI_VERSION` | `latest` (default) or `0.1.0` / `v0.1.0` |
| `VORTEX_GUI_REPO` | `owner/name` (default `vortexssh/vortex-gui`) |
| `VORTEX_GUI_DIR` | custom install root |
| `VORTEX_GUI_PREFERRED` | Linux: `appimage`\|`deb` · Windows: `nsis`\|`msi` |
| `VORTEX_GUI_GITHUB_TOKEN` | private release downloads |

## Uninstall (Unix user-local)

```bash
curl -fsSL https://raw.githubusercontent.com/vortexssh/vortex-gui/master/scripts/uninstall.sh | bash
```

Config/DB under `~/.config/vortex-gui/` is kept.

## Publishing a release

1. Bump `version` in `package.json` and `src-tauri/tauri.conf.json`.
2. Tag and push: `git tag v0.1.0 && git push origin v0.1.0`
3. GitHub Actions [`.github/workflows/release.yml`](../.github/workflows/release.yml) builds AppImage/deb/dmg/NSIS/MSI and attaches them to the release.

To mirror the install script on the landing site:

```bash
# from this repo
scp scripts/install.sh scripts/install.ps1 scripts/uninstall.sh \
  user@host:/var/www/vortex.timant32.ru/gui/
```

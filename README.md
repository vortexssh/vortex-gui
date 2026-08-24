# Vortex GUI

Local-first desktop client for **VortexSSH** (Tauri 2 + React 18). Secrets for SSH never leave this machine. Vortex Core is a metadata notebook and NAT proxy — not a vault.

## Install

**Linux / macOS**

```bash
curl -fsSL https://raw.githubusercontent.com/vortexssh/vortex-gui/master/scripts/install.sh | bash
```

**Windows (PowerShell)**

```powershell
irm https://raw.githubusercontent.com/vortexssh/vortex-gui/master/scripts/install.ps1 | iex
```

Details, env vars, uninstall: [`scripts/README.md`](scripts/README.md).

## Develop

```bash
npm install
npm run tauri dev
```

Release builds: push a `v*` tag (see `.github/workflows/release.yml`) — produces AppImage, deb, dmg, NSIS, MSI.

Data directory: `~/.config/vortex-gui/` (`vortex.db`, optional `master.key`). Do not share this DB with TUI; use E2EE `.vortex` export/import.

## Behaviour (TUI parity)

| Mode | What happens |
|---|---|
| Local-only | No API key. Roster + AES-256-GCM secrets on disk. Direct SSH. |
| Linked | Device-link login in Vortex Web → `vxk_` key. Sync metadata. Direct and/or Proxy. |

- Merge cloud ↔ local by `host_id`. Cloud never overwrites local secrets.
- Proxy: `WSS /ws/proxy/{id}?token=` → wait for `{"type":"proxy_ready"}` → binary SSH.
- 2FA: proxy and telemetry fail closed. UI opens the cabinet (`/security/2fa`), it does not bypass TOTP.
- `.vortex` files: magic `VRTX`, Argon2id (t=3, 64 MiB, p=4) + AES-256-GCM — same as TUI.

## Zero-trust

JSON to Core must not contain `password`, `private_key`, `ssh_key`, `secret`, `passphrase` (account password on `/auth/login` is the only exception, unused here — GUI uses browser device-link).

## Defaults

- Core: `https://api.vortex.timant32.ru`
- Web: `https://my.vortex.timant32.ru`

Read [`AGENTS.md`](AGENTS.md), [`docs/CLIENT.md`](docs/CLIENT.md), [`docs/API.md`](docs/API.md).

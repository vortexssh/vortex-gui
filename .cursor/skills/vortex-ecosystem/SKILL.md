---
name: vortex-ecosystem
description: >-
  VortexSSH architecture, zero-trust client rules, Core REST/WS proxy protocol,
  TUI parity, and production domains. Use when building Vortex GUI, syncing
  hosts, implementing SSH proxy, device-link login, or when a new agent needs
  full ecosystem context without Core in the workspace.
---

# Vortex GUI — ecosystem skill

1. [`AGENTS.md`](../../../AGENTS.md) — scope of this repo.
2. [`docs/ECOSYSTEM.md`](../../../docs/ECOSYSTEM.md) — Core/Web/Agent/domains.
3. [`docs/CLIENT.md`](../../../docs/CLIENT.md) — local secrets, merge, proxy WS, browser login.
4. [`docs/API.md`](../../../docs/API.md) — endpoints the GUI actually calls.
5. Reference code: `~/VortexSSH/VortexSSH-TUI` (`api/`, `ssh/proxy.go`, `crypto/`, `db/`).

Do not send SSH secrets to Core. Do not implement the host agent here.

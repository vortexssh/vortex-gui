# VortexSSH — ecosystem (for GUI agents)

Контекст продукта, когда открыт только VortexGui. Код облака — в соседних каталогах `~/VortexSSH/`.

## Зачем

Флот за NAT/CGNAT: 22 снаружи не открыть, ключи не должны лежать в облаке.  
Агент на хосте сам выходит на Core по WSS. GUI/TUI либо SSH **напрямую** (если IP доступен), либо через **Vortex Proxy**.

## Слои

```
[GUI / TUI / Web]
        |  HTTPS /api/v1   +   WSS /ws/proxy|/ws/pty
        v
   Vortex Core (FastAPI, Postgres metadata, Redis telemetry)
        ^
        | исходящий WSS /ws/agent  (порты агента наружу НЕ слушаются)
        |
   vortex-agent (Go) на целевой машине → loopback sshd / PTY / tasks
```

| Слой | Путь | Стек | Роль |
|---|---|---|---|
| Core | `VortexCore` | Python 3.11+, FastAPI, SQLAlchemy 2, asyncpg, Redis, Alembic, JWT+TOTP | REST + tunnel |
| Web | `VortexWeb` | Vite, React 19, TS, Tailwind 4, Zustand, React Query, xterm | кабинет `my.` |
| Site | `VortexSite` | Vite React | лендинг apex |
| Agent | `VortexAgent` | Go, systemd | хост-демон |
| TUI | `VortexSSH-TUI` | Go, Bubble Tea | эталон клиента |
| GUI | **VortexGui** | TBD native | этот клиент |
| Telegram | `VortexTG-bot` | — | напоминания |

GitHub org: `vortexssh` (`vortex-core`, `vortex-web`, `vortex-site`). Agent/TUI/GUI могут быть ещё не на GH.

## Прод-домены (уже после cutover)

| Host | Что |
|---|---|
| `https://vortex.timant32.ru` | лендинг + `/agent/` бинарники |
| `https://my.vortex.timant32.ru` | кабинет (Vortex Web, docker `:18080`) |
| `https://api.vortex.timant32.ru` | Core REST `/api/v1` + WSS `/ws/*` |
| `https://my.vortex.timant32.ru/u/{slug}` | публичный статус (apex `/u/` редиректит сюда) |

VPS: SSH alias `timant32`. `/opt/vortex-core`, `/opt/vortex-web`, `/opt/vortex-site`.  
Локально Core: `docker compose -f docker-compose.dev.yml` → Postgres+Redis, API на `:8000`.

GUI defaults: Core `https://api.vortex.timant32.ru`, Web `https://my.vortex.timant32.ru`.

## Core — что можно слать

**Postgres (метаданные, не SSH-секреты):**  
users, api_keys (`vxk_…` plaintext один раз), hosts (name, ip, port, username, tags, proxy/hidden, geo, billing), agents (hash секрета, online), tasks, plugins, notifications, billing_payers.

**Redis:** `telemetry:{host_id}` TTL, `agent:presence:{id}` TTL ~90s. Метрики **не** в Postgres.

**Auth:** JWT после login; API key `vxk_`. Headers: `Authorization: Bearer <jwt|vxk_>` или `X-API-Key: vxk_…` (TUI для ключей предпочитает `X-API-Key`).  
Агент: `vxa_…`. Plugin daemon: `vxp_…`.

**Host JSON:** схемы отвергают `password` / `private_key` / `ssh_key` / `secret` / `passphrase`.

## 2FA — SECURITY_LEVEL на Core

| Level | Login TOTP | Agent gates (proxy, pty, telemetry, tasks) |
|---|---|---|
| `debug` | не спрашивается ни у кого | выключены |
| `dev` | TOTP если `is_2fa_enabled` **и** `require_2fa` (поле БД) | то же |
| `prod` | флаг БД игнорируется; если 2FA уже включена — код обязателен | 2FA обязательна у всех; disable запрещён |

`GET /users/me` → `require_2fa` это **эффективный** флаг, не сырое поле БД. Прод: `APP_ENV=production` / `SECURITY_LEVEL=prod`.

Новый пользователь: login без TOTP → в кабинете включает 2FA → proxy начинает работать.

## WebSocket

| Path | Кто | GUI |
|---|---|---|
| `/ws/proxy/{host_id}?token=` | user + 2FA + `is_proxy_enabled` | **да** — сырой TCP/SSH |
| `/ws/pty/{host_id}?token=&cols=&rows=` | user + 2FA | опционально (встроенный терминал) |
| `/ws/agent?...` | агент | нет |
| `/ws/plugin/...` | plugin daemon | нет |

После accept Core шлёт `proxy_ready` / `pty_ready`. Дальше binary. Ресайз PTY: JSON `pty_resize`.

Один `agent_id` = один живой сокет; reconnect заменяет старый (code 4000).

## Agent на хосте (не GUI)

Env: `VORTEX_CORE_URL`, `VORTEX_AGENT_ID`, `VORTEX_SECRET_TOKEN`.  
Telemetry ~5s, heartbeat ~30s. SSH для proxy только `127.0.0.1:22`.  
Enroll: кабинет Hosts → Install agent; бинарники `https://vortex.timant32.ru/agent/`.

## Billing / plugins

Календарь, payers, FX, Renew — в Web. GUI может не делать биллинг в MVP.  
Плагины — out-of-process daemons, UI bundle в Web. GUI не обязан рендерить plugin DSL.

## Известные грабли Core/Web (не чинить в GUI)

- Stale `disconnect_agent` без проверки websocket (починено `ab627ae`).
- Billing «Left to pay» считал `date >= today` (починено во Web).
- Device-link Web: только `client=vortex-tui` (GUI: тот же client или патч Web).

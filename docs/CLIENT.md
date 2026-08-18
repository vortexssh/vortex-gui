# Vortex GUI / TUI — клиентский протокол

Эталон: `~/VortexSSH/VortexSSH-TUI`. GUI должен совпадать по смыслу, даже если стек другой.

## Режимы

1. **Local-only** — нет API key. Хосты и секреты только на диске. Direct SSH.
2. **Linked** — есть `vxk_…`. Синк метаданных с Core. Direct и/или Proxy.

Синк при старте по умолчанию **выключен** (TUI: `SyncOnStart=false`).

## Локальное хранилище

TUI: `~/.config/vortex-tui/` (`vortex.db`, optional `master.key`).  
GUI: `~/.config/vortex-gui/` — **отдельный** каталог. Обмен секретами — через E2EE `.vortex`, не общим файлом.

- Secrets at rest: AES-256-GCM.
- Master key: OS keyring (`vortex-gui` / `db-master-key`); fallback file 0600.
- Host row **без** plaintext секрета; `HasSecret` bool.
- Auth types как в TUI: `password` | `private_key` (PEM в payload).

### Merge cloud ↔ local

Join по `host_id` (UUID с Core).  
Cloud даёт: name, ip, port, username, tags, `is_proxy_enabled`, agent online/id, sort_order.  
Local держит: secret payload, возможно extra notes.  
Не затирать local secret облаком (облако секрета не имеет).  
Создали хост только locally — `source=local`, на Core не уходит, пока пользователь не «publish metadata».

## Direct SSH

Как обычный клиент: `username@ip:port` + local secret.  
`golang.org/x/crypto/ssh` / аналог. Не через Core.

## Vortex Proxy (NAT)

Нужно: host на Core, `is_proxy_enabled=true`, агент **online**, 2FA (если `require_2fa` эффективный true).

1. `GET /api/v1/hosts` — найти id.
2. Собрать URL (TUI `WSProxyURL`):
   - `https://api…` → `wss://api…/ws/proxy/{host_id}?token={jwt|vxk_}`
   - `http://127.0.0.1:8000` → `ws://…`
3. Dial WebSocket.
4. Первое текстовое сообщение: `{"type":"proxy_ready","session_id":"…"}`. Иначе ошибка (часто 1008 = нет 2FA / offline / proxy off).
5. Дальше **binary** = сырой TCP к `127.0.0.1:22` на хосте через агента. Обернуть в `net.Conn` и отдать SSH-клиенту (см. TUI `ssh/proxy.go`).
6. Control JSON `proxy_error` — закрыть сессию.

GUI **сам** делает SSH (user/key с диска) по этому конвейеру. Core пароль SSH не видит.

PTY в браузере (`/ws/pty`) — фича Web. GUI может не делать web-PTY, если есть настоящий SSH.

## Device-link логин (предпочтительно)

Auth UI живёт в **Vortex Web**, не в Core.

1. Слушать `http://127.0.0.1:<random>/callback`.
2. Открыть браузер:
   `{web}/login?client=vortex-tui&redirect_uri=http://127.0.0.1:{port}/callback&state={hex}`
   (`client` пока только `vortex-tui` в Web `tuiLink.ts`; для GUI либо тот же client, либо расширить Web).
3. `redirect_uri` только loopback (`127.0.0.1` / `localhost` / `::1`).
4. После логина Web выпускает API key `vxk_…` и редиректит:
   `?token=vxk_…&state=…&email=…&token_type=api_key`
5. Сохранить key locally. Не класть JWT долгоживущим, если есть key.

Альтернатива: `POST /api/v1/auth/login` {email, password, totp_code?} → JWT. Для GUI хуже UX (свой TOTP UI), но допустимо. Не логировать password.

## REST, которые TUI уже бьёт

См. [`API.md`](API.md). Минимум GUI MVP: health, me, hosts CRUD (без секретов), tags, patch proxy, telemetry (2FA), WS proxy.

## E2EE export

TUI `.vortex`: magic `VRTX`, Argon2id + AES-256-GCM. Имеет смысл тот же формат, чтобы TUI↔GUI обмен работал (`crypto/crypto.go`).

## Настройки клиента

| Поле | Default prod |
|---|---|
| Core URL | `https://api.vortex.timant32.ru` (без суффикса `/api/v1` в TUI base; пути уже с `/api/v1`) |
| Web URL | `https://my.vortex.timant32.ru` |
| API key | empty = local-only |
| Sync on start | false |

TUI `Client.BaseURL` = origin Core; запросы `/api/v1/hosts`. Не дублировать `/api/v1` в base.

## Запрещено

- Формы «сохранить root password в облако».
- Свой облачный vault ключей.
- Слушать порты как агент.
- Складывать `vxa_` agent secrets в GUI (это хост, не клиент).

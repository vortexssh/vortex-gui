# Core API — что вызывает GUI

Base prod: `https://api.vortex.timant32.ru`  
Local: `http://127.0.0.1:8000`  
OpenAPI: `{base}/docs`  
Health: `GET /api/v1/health` → `{"status":"ok"}`

Auth на каждом запросе: `X-API-Key: vxk_…` **или** `Authorization: Bearer <jwt|vxk_>`.

Ошибки JSON: `{ "detail": { "code": "...", "message": "..." } }`.  
Частые коды: `totp_required`, `invalid_totp`, `2fa_required`, `email_not_verified`, `host_not_found`.

## Аккаунт

| Method | Path | Зачем |
|---|---|---|
| POST | `/api/v1/auth/register` | email+password ≥8 |
| POST | `/api/v1/auth/login` | email, password, optional `totp_code` |
| POST | `/api/v1/auth/verify-email` | token из письма |
| GET | `/api/v1/users/me` | `id`, `email`, `is_2fa_enabled`, **effective** `require_2fa` |
| POST | `/api/v1/api-keys` | `{name}` → plaintext `key` один раз |
| GET/DELETE | `/api/v1/api-keys` | список / revoke |

Логин в prod: если 2FA уже включена — без `totp_code` будет `totp_required`. Device-link через Web это закрывает.

## Хосты (только метаданные)

| Method | Path |
|---|---|
| GET | `/api/v1/hosts` |
| POST | `/api/v1/hosts` |
| PATCH | `/api/v1/hosts/{id}` |
| DELETE | `/api/v1/hosts/{id}` |
| PATCH | `/api/v1/hosts/{id}/proxy` `{is_proxy_enabled}` |
| PATCH | `/api/v1/hosts/reorder` `{host_ids:[…]}` |

Тело create (TUI): `{name, ip_address, port, username, is_proxy_enabled}`.  
**Не слать** password/private_key.

Ответ host (минимум): `id`, `name`, `ip_address`, `port`, `username`, `is_proxy_enabled`, `sort_order`, `tags[]`, `agent?: {id, is_online, version, last_seen_at}`.

## Теги

`GET/POST /api/v1/tags`, привязка через host update (см. OpenAPI).

## Телеметрия (2FA)

`GET /api/v1/hosts/{id}/telemetry`  
Поля: `cpu_percent`, `ram_percent`, `ram_used_bytes`, `ram_total_bytes`, `net_bytes_sent`, `net_bytes_recv`, `uptime_seconds`, `collected_at`. Redis TTL — может быть пусто, если агент молчит.

## Задачи (2FA, не MVP)

CRUD `/api/v1/hosts/{id}/tasks`, `POST /tasks/{id}/run`, logs.

## Агенты (2FA, обычно Web)

`POST /api/v1/hosts/{id}/agents` — выдаёт `vxa_…` один раз. GUI enroll не обязателен.

## WebSocket proxy

`GET` upgrade `{wsBase}/ws/proxy/{host_id}?token={token}`  
`wsBase`: `wss://api.vortex.timant32.ru` или `ws://127.0.0.1:8000`.

Handshake: JSON `proxy_ready`. Затем binary SSH.  
Отказ: WS 1008 (2FA / no agent / proxy disabled), 1013 agent offline.

## PTY (опционально)

`/ws/pty/{host_id}?token=&cols=&rows=` → `pty_ready`. Binary = PTY bytes. Ресайз: `{"type":"pty_resize","cols":n,"rows":n}`. Это **shell на агенте**, не ваш local secret — другой UX, чем Proxy+SSH.

## Что GUI не нужен в MVP

Billing, payers, plugins ui-bundle, public `/public/u/{slug}`, Telegram link, notification inbox (можно позже).

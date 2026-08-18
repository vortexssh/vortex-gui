# Repos, URLs, tokens

## Диск

| Каталог | Роль |
|---|---|
| `~/VortexSSH/VortexCore` | API |
| `~/VortexSSH/VortexWeb` | кабинет |
| `~/VortexSSH/VortexSite` | лендинг |
| `~/VortexSSH/VortexAgent` | хост-агент |
| `~/VortexSSH/VortexSSH-TUI` | TUI-клиент (копировать протокол) |
| `~/VortexSSH/VortexGui` | этот GUI |
| `~/VortexSSH/VortexTG-bot` | Telegram |

GitHub: `github.com/vortexssh/{vortex-core,vortex-web,vortex-site}`.

## URLs

| Что | Prod | Local |
|---|---|---|
| Core | `https://api.vortex.timant32.ru` | `http://127.0.0.1:8000` |
| Web login | `https://my.vortex.timant32.ru` | `http://127.0.0.1:5173` |
| Landing | `https://vortex.timant32.ru` | — |
| Agent bins | `https://vortex.timant32.ru/agent/` | — |

## Префиксы (не коммитить живые)

| Prefix | Kind |
|---|---|
| `vxk_` | user API key (GUI хранит locally) |
| `vxa_` | agent secret (хост, не GUI) |
| `vxp_` | plugin daemon |

## VPS

SSH `timant32`. Не деплоить GUI на VPS — это приложение пользователя.

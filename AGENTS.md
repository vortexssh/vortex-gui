# AGENTS.md — Vortex GUI

Этот репозиторий — **десктопный GUI-клиент** VortexSSH (local-first).  
Не Core, не Web-кабинет, не агент на хосте, не лендинг.

Новый агент: сначала этот файл + [`docs/ECOSYSTEM.md`](docs/ECOSYSTEM.md) + [`docs/CLIENT.md`](docs/CLIENT.md).

## Продукт

VortexSSH — гибридное управление флотом за NAT.

```
[GUI / TUI]  --HTTPS + WSS (vxk_/JWT)-->  [Vortex Core]
                                                ^
                                                | исходящий WSS
                                          [vortex-agent на хосте]
```

| Слой | Где код | Роль GUI |
|---|---|---|
| Core | `~/VortexSSH/VortexCore` | REST метаданных + `/ws/proxy` для SSH через NAT |
| Web | `~/VortexSSH/VortexWeb` | браузерный кабинет; device-link логин |
| Agent | `~/VortexSSH/VortexAgent` | на **сервере**, не в GUI |
| TUI | `~/VortexSSH/VortexSSH-TUI` | эталон local-first клиента — копируй протокол |
| Site | `~/VortexSSH/VortexSite` | лендинг `vortex.timant32.ru` |
| **GUI** | **этот каталог** | нативный клиент: ростер, direct SSH, proxy SSH, секреты locally |

## Жёсткие правила

1. **Zero-trust к облаку.** Пароли и private key целевых серверов **никогда** не уходят в Core/Web. Запрещённые JSON-поля: `password`, `private_key`, `ssh_key`, `secret`, `passphrase`. Core их отвергает; GUI не должен даже пытаться.
2. **Секреты только locally.** Как TUI: SQLite (или аналог) + AES-256-GCM, master key в OS keyring. Join cloud↔local по `host_id`.
3. **Local-first.** Без аккаунта GUI должен уметь хранить хосты и ходить **direct SSH**. Облако опционально.
4. **2FA на остром контуре.** Telemetry, `/ws/proxy`, `/ws/pty`, tasks — Core режет без TOTP (уровень `prod`). GUI показывает ошибку и ведёт в кабинет настроить 2FA, не обходит.
5. **Не путать пароли.** Пароль аккаунта Vortex (login) ≠ пароль SSH. Login password на `/auth/login` можно слать; SSH password — нет.

## Этот клиент — поведение (как TUI)

- Ростер: local + cloud metadata, merge по `host_id`.
- Connect: **direct** (`golang.org/x/crypto/ssh` или libssh) **или** Vortex Proxy (`WSS /ws/proxy/{host_id}?token=`), затем сырой SSH поверх `net.Conn`.
- Proxy: дождаться JSON `{"type":"proxy_ready","session_id":"..."}`, дальше **binary frames**.
- Auth в облако: браузерный device-link на Vortex Web, не своя HTML-форма на Core. См. [`docs/CLIENT.md`](docs/CLIENT.md).
- Данные: `~/.config/vortex-gui/` (не шарить БД с TUI без явного импорта `.vortex`).

## Куда не писать код

| Запрос | Репо |
|---|---|
| FastAPI, агент handshake, биллинг backend | VortexCore |
| Кабинет / WebSSH в браузере | VortexWeb |
| systemd-агент на VPS | VortexAgent |
| Лендинг | VortexSite |
| Этот десктоп | **здесь** |

Device-link в Web сейчас принимает `client=vortex-tui`. Пока Web не расширен — GUI может слать тот же `client`, либо сначала патч в VortexWeb (`vortex-gui`).

# Переписывание tapo-wall: GUI-настройка камер + свободная раскладка

> **Способ выполнения:** subagent-driven. Каждую задачу реализует дешёвый subagent `deepseek-official/deepseek-flash` строго по TDD; затем свежий subagent-ревьюер проверяет diff. Финальный ревью критичных мест и всей ветки — более сильная модель сессии. Задачи идут строго по порядку (зависимости).

## Цель и критерии успеха

Переписать `tapo-wall` так, чтобы пользователь ни разу не открывал конфиг: склонировал репо → `npm start` → в браузере добавляет/меняет камеры через меню, а камеры на холсте двигаются/растягиваются/поворачиваются/масштабируются. Раскладка и настройки сохраняются на сервере.

**Готово, когда:**
1. `npm start` одной командой поднимает всё (MediaMTX + сервер + собранный UI).
2. Камеру можно добавить/изменить/удалить целиком из интерфейса.
3. Камеры на холсте двигаются/растягиваются/поворачиваются/масштабируются; раскладка переживает перезагрузку.
4. Кнопка «Прибрать» раскладывает камеры по сетке.
5. Пароли RTSP маскируются и никогда не возвращаются из API.
6. Все тесты (server + web) зелёные, сборка/линт чистые, `npm run smoke` и CI зелёные.
7. Каждая задача прошла ревьюера.

**Объём:** только конфиг + раскладка + дизайн/рефакторинг. WebRTC, Telegram-алерты, записи — вне рамок.

## Архитектурные решения

- Схема `config/cameras.json` расширяется: `cameras[].layout: { x, y, w, h, rotation, scale }` (опционально) и корневой `auth: { token?: string }` (опционально). Старые конфиги загружаются; `layout` по умолчанию вычисляется (не пишется, пока не сохранили).
- `config-store.ts` владеет конфигом в памяти, атомарно пишет на диск (tmp + rename) + бэкап `cameras.json.bak`, валидирует zod.
- `runtime.ts` применяет изменения без рестарта HTTP: пересоздаёт `mediamtx.yml` и перезапускает MediaMTX/статус-монитор **только если изменился отпечаток потоков** (набор RTSP-источников).
- `CameraGrid` заменяется на `CameraCanvas` (прокручиваемая сцена, абсолютное позиционирование, `transform: translate→rotate→scale`). Два режима на тулбаре: «Просмотр» (клик → HD) и «Раскладка» (жесты). Двойной клик в любом режиме открывает HD.
- Пароли не покидают сервер: `GET /api/config` → `passwordSet: boolean`; `PUT /api/config` принимает `password` только как новое значение (пусто → оставить). Новая камера без пароля → 422.
- Опциональный токен: заголовок `X-Tapo-Token`; пока не задан — всё открыто; после задания защищены `GET/PUT /api/config`. Токен в UI — `localStorage`, при 401 — запрос.
- Стек: Node/Express + zod + vitest; React 19 + Tailwind 4 + shadcn/ui + hls.js. Web-тесты: vitest + `@testing-library/react` + `jsdom`.

## Публичный API и схема

Схема (server, zod):
```ts
Config { httpPort; auth?: { token?: string }; mediamtx: { hlsAddress; apiAddress; webrtcAddress? }; cameras: Camera[] }
Camera { id /* slug, уникальный */; name; host; port; username; password; streams: { hd; preview }; layout?: { x; y; w; h; rotation; scale } }
```

Эндпоинты:
| Метод/путь | Токен | Описание |
|---|---|---|
| `GET /api/health` | — | `{ ok, uptime }` |
| `GET /api/cameras` | — | `{ cameras: CameraInfo[] }`: `id, name, status, layout, preview{hls,webrtc}, hd{hls,webrtc}` — без секретов |
| `GET /api/config` | да* | редактируемый вид: камеры с `host, port, username, streams, layout` и `passwordSet: boolean`; `authEnabled`, `httpPort`, `mediamtx` |
| `PUT /api/config` | да* | тот же вид; `password` — строка/отсутствует (keep); `{ ok, warnings }` |

`*` — токен требуется только когда `auth.token` задан.

Слияние пароля: непустая строка → записать; пусто/отсутствует у существующей → сохранить; у новой (`id` не было) → 422.

## Изменения по подсистемам

**Server:** `config.ts` (+schema/normalize), `config-store.ts` (новый), `runtime.ts` (новый), `app.ts` (новый, `createApp`), `index.ts` (тонкий), `cameras.ts` (+layout), `status.ts`/`mediamtx*.ts` без изменений.

**Web:** `lib/types.ts`, `lib/api.ts`, `lib/layout.ts` (новый), `components/CameraCanvas.tsx` (новый), `components/CameraTile.tsx`, `components/SettingsDialog.tsx` (новый), `components/Toolbar.tsx` (новый), `App.tsx`.

**Скрипты/CI:** `scripts/smoke.mjs`, `web/package.json` + vitest-конфиг, корневой `package.json` (`test` → server+web), `.github/workflows/ci.yml`.

## Крайние случаи (Review Focus)

1. Пароль со спецсимволами не ломает YAML.
2. Дубликат `id` → 422; slug-валидация на лету.
3. Новая камера без пароля → 422; существующая с пустым паролем → keep.
4. Порт занят при перезапуске MediaMTX → конфиг сохранён, `{ ok, warnings }`, toast, плитки offline/connecting.
5. Конфиг повреждён/отсутствует → дефолты, UI грузится; ошибки сохранения inline.
6. Удаление последней камеры → пустое состояние с CTA.
7. Удалённая камера не оставляет мусора в статусах (монитор перезапущен).
8. Жесты: `scale ∈ [0.25,4]`, `rotation ∈ [0,360)`, мин. размер, drag в границах.
9. Токен задан и забыт → 401 → UI просит; сброс требует текущий токен.
10. Повторные сохранения сериализуются, last-write-wins.

## Задачи (TDD, по порядку)

### Task 1 — Тестовая инфраструктура web
- `web/package.json`, `web/vite.config.ts` (+`vitest.config.ts`), `web/src/test/setup.ts`, корневой `package.json`, `.github/workflows/ci.yml`.
- `npm --prefix web test` (vitest, jsdom) работает; корневой `npm test` = server+web; CI запускает web-тесты.

### Task 2 — Схема + `config-store.ts`
- `server/src/config.ts`, `server/src/config-store.ts` (новый), `config-store.test.ts`.
- `normalizeConfig(raw)`, `ConfigStore { load(); get(); save(mutator); onChange(cb) }`; атомарная запись + `.bak`; слияние пароля; уникальность `id`; нормализация layout.

### Task 3 — `runtime.ts`
- `server/src/runtime.ts` (новый), `runtime.test.ts`.
- `applyConfig(prev, next)`, `streamFingerprint(config)`; перезапуск только при изменении отпечатка; `warnings`.

### Task 4 — `app.ts` + маршруты
- `server/src/app.ts` (новый), `index.ts` (тонкий), `app.test.ts` (supertest).
- `createApp({ store, runtime })`, `requireToken`, `GET /api/cameras` (+layout), `GET/PUT /api/config`.

### Task 5 — Smoke + документация
- `scripts/smoke.mjs`, `README.md`, `docs/config-reference.md`.

### Task 6 — `lib/layout.ts` (чистая геометрия)
- `web/src/lib/layout.ts` (новый), `layout.test.ts`.
- `DEFAULT_LAYOUT`, `normalizeLayout`, `clampLayout`, `autoArrange`, `transformPoint`, `screenDeltaToLocal`, `computeResize`, `computeRotation`.

### Task 7 — `CameraCanvas` + `CameraTile`
- `web/src/components/CameraCanvas.tsx` (новый), `CameraTile.tsx`, `CameraCanvas.test.tsx`.
- Два режима; drag/resize/rotate/scale; двойной клик → HD; клавиатура; debounce-сохранение.

### Task 8 — `SettingsDialog` + `Toolbar` + `api.ts` + `App.tsx`
- `web/src/lib/api.ts`, `types.ts`, `SettingsDialog.tsx`, `Toolbar.tsx`, `App.tsx`, тесты.
- CRUD камер, «Защита» (токен), «Прибрать», переключатель режимов, 401 → токен, toast при warnings.

### Task 9 — Дизайн, доступность, состояния
- UI-компоненты, `index.css` (точечно), `App.tsx`.
- Полировка, фокус/contrast, пустое/ошибочное состояние, тёмная тема.

### Task 10 — Финальный ревью + зелёный пайплайн
- Полный `npm test` + сборки + `npm run smoke` + lint; ревью критичных диффов и всей ветки; документация актуальна.

## Допущения

- Node ≥ 20; `npm start`, автозагрузка MediaMTX, `scripts/start.mjs`/`smoke.mjs` сохраняются.
- Язык UI — русский; стек не меняется.
- `httpPort` — read-only в UI; адреса MediaMTX — в «Расширенных» (перезапуск MediaMTX).
- Раскладка в логических пикселях + `rotation` (град) + `scale`; «Прибрать» пересчитывает x/y по сетке.
- Автоперсист раскладки — debounce ~500 мс; форма камеры сохраняется явной кнопкой.

# tapo-wall rewrite — task checklist

> Способ выполнения: каждая задача — subagent на `deepseek-official/deepseek-flash` строго по TDD, затем ревьюер. Подробности — `tasks/plan.md`.

- [x] Task 1 — Тестовая инфраструктура web (vitest + testing-library + jsdom) + CI + корневой `npm test`
- [x] Task 2 — Схема конфига (`layout`, `auth`) + `server/src/config-store.ts`
- [x] Task 3 — `server/src/runtime.ts` (отпечаток потоков, перезапуск MediaMTX/статус-монитора)
- [x] Task 4 — `server/src/app.ts` (фабрика + маршруты + `requireToken`), рефакторинг `index.ts`
- [x] Task 5 — `scripts/smoke.mjs` + README + `docs/config-reference.md`
- [x] Task 6 — `web/src/lib/layout.ts` (чистая геометрия) + тесты
- [x] Task 7 — `web/src/components/CameraCanvas.tsx` + `CameraTile.tsx` (drag/resize/rotate/scale)
- [x] Task 8a — `web/src/lib/types.ts` + `api.ts` + `SettingsDialog.tsx` (CRUD камер, токен, MediaMTX)
- [x] Task 8b — `Toolbar.tsx` + `App.tsx` (холст + настройки + персист раскладки + токен)
- [x] Task 9 — Чистка мёртвого кода (CameraGrid, unused prop, refs), полировка
- [x] Task 10 — Финальный ревью + полный зелёный пайплайн

## Чекпоинты
- [x] Checkpoint 0 (после Task 1–2): серверные и web-тесты запускаются и зелёные
- [x] Checkpoint 1 (после Task 3–5): сервер управляем из API, smoke зелёный
- [x] Checkpoint 2 (после Task 6–8): полный пользовательский путь работает вручную
- [x] Checkpoint Complete (после Task 9–10): все критерии успеха выполнены

## Итог
- Server: 128 тестов зелёные, `tsc` чистый.
- Web: 57 тестов зелёные, сборка чистая, lint 0 ошибок (5 advisory-warnings).
- `npm run smoke` → SMOKE OK.
- UI проверен в браузере: холст, переключатель Просмотр/Раскладка, «Прибрать», диалог настроек (камеры + токен + MediaMTX).

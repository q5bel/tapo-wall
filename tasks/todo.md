# tapo-wall rewrite — task checklist

> Способ выполнения: каждая задача — subagent на `deepseek-official/deepseek-flash` строго по TDD, затем ревьюер. Подробности — `tasks/plan.md`.

- [ ] Task 1 — Тестовая инфраструктура web (vitest + testing-library + jsdom) + CI + корневой `npm test`
- [ ] Task 2 — Схема конфига (`layout`, `auth`) + `server/src/config-store.ts`
- [ ] Task 3 — `server/src/runtime.ts` (отпечаток потоков, перезапуск MediaMTX/статус-монитора)
- [ ] Task 4 — `server/src/app.ts` (фабрика + маршруты + `requireToken`), рефакторинг `index.ts`
- [ ] Task 5 — `scripts/smoke.mjs` + README + `docs/config-reference.md`
- [ ] Task 6 — `web/src/lib/layout.ts` (чистая геометрия) + тесты
- [ ] Task 7 — `web/src/components/CameraCanvas.tsx` + `CameraTile.tsx` (drag/resize/rotate/scale)
- [ ] Task 8 — `web/src/components/SettingsDialog.tsx` + `Toolbar.tsx` + `api.ts` + `App.tsx`
- [ ] Task 9 — Дизайн-полировка, доступность, состояния
- [ ] Task 10 — Финальный ревью + полный зелёный пайплайн

## Чекпоинты
- [ ] Checkpoint 0 (после Task 1–2): серверные и web-тесты запускаются и зелёные
- [ ] Checkpoint 1 (после Task 3–5): сервер управляем из API, smoke зелёный
- [ ] Checkpoint 2 (после Task 6–8): полный пользовательский путь работает вручную
- [ ] Checkpoint Complete (после Task 9–10): все критерии успеха выполнены

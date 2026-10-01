# Origin and Host Guard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop other websites from writing to, or reading from, the local Backlog.md web server, through cross-site requests or DNS rebinding.

**Architecture:** One pure guard function decides per request: allow, or reject with 403/421. `BacklogServer` wraps every route handler (and the `fetch` fallback, including the WebSocket upgrade) with it in one place, so new routes are covered automatically.

**Tech Stack:** Bun 1.3.14+ (`Bun.serve` routes), TypeScript, Bun test.

## Global Constraints

- The server binds to `127.0.0.1` only (`BROWSER_HOST`, `src/server/index.ts:224`).
- Allowed `Host` header values: `127.0.0.1:<port>` and `localhost:<port>`, where `<port>` is the server's actual port. Comparison is case-insensitive.
- Every request with any other `Host` (or none) → `421 Misdirected Request`, body `{ "error": "Host not allowed" }`. This blocks DNS rebinding for reads and writes.
- For methods other than `GET`, `HEAD`, `OPTIONS`, and for WebSocket upgrade requests: when an `Origin` header is present, its host (`URL(origin).host`) must be one of the allowed hosts and its scheme `http:`; otherwise `403`, body `{ "error": "Origin not allowed" }`. `Origin: null` is rejected. A request without `Origin` is allowed (CLI tools, curl, tests).
- `GET`/`HEAD` keep working for same-host navigation, images, and the SPA.
- No new config keys, no UI changes.
- Biome: tabs, double quotes. Definition of done: `bunx tsc --noEmit`, `bun run check .`, `bun test` (known unrelated failures: config-commands "column 0", cli-json-watch launcher kill, 2x cli-pipe-output delayed pipe reader; flaky under load: git hard-kill, content-store tests, board-tui-move, cli-dependency `--clear-deps`, server SPA fallback).
- Commits: subject `fix(server): <summary>`, blank line, then exactly:
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
  `Claude-Session: https://claude.ai/code/session_013yqnsg7HFt3E7RreoDQSUC`
  No `--no-verify`. Do not create backlog tasks. Do not edit `MANIFESTO.md`.

---

### Task 1: Request guard for the web server

**Files:**
- Create: `src/server/request-guard.ts`
- Modify: `src/server/index.ts` (`start()` route table near `:407-545`, `handleRequest` / WebSocket upgrade near `:786`)
- Test: `src/test/server-request-guard.test.ts` (pure function) and `src/test/server-request-guard-http.test.ts` (real server)

**Interfaces:**
- Produces: `export function checkRequest(req: Request, port: number): Response | null` — returns `null` to allow, or the rejection `Response` (421 or 403 JSON as in Global Constraints).

- [ ] **Step 1: Write failing unit tests for `checkRequest`.** Build `Request` objects directly (`new Request("http://127.0.0.1:6420/api/tasks", { method, headers })`). Cases:
  - `Host: 127.0.0.1:6420` and `Host: LOCALHOST:6420`, GET, no Origin → `null`.
  - `Host: evil.example:6420` → 421; `Host: 127.0.0.1:9999` (wrong port) → 421; missing Host → 421. Note: `new Request` may not let you set `Host`; if it ignores the header, build the guard to read `req.headers.get("host")` and construct test requests through a small helper that sets it with `new Headers(...)`; if Bun forbids it, use a plain object shaped like `{ method, headers: Headers }` cast to `Request` and say so in the report.
  - POST with `Origin: http://127.0.0.1:6420` → `null`; with `Origin: http://localhost:6420` → `null`; with `Origin: https://evil.example` → 403; `Origin: null` → 403; `Origin: http://127.0.0.1:9999` → 403; no Origin → `null`.
  - GET with `Origin: https://evil.example` and good Host → `null` (cross-origin reads are already blocked by the browser's same-origin policy; Host check covers rebinding).
  - WebSocket upgrade (`Upgrade: websocket`, GET) with `Origin: https://evil.example` → 403; with a same-host Origin → `null`.
  - Response bodies are JSON `{ error: "Host not allowed" }` / `{ error: "Origin not allowed" }`.
- [ ] **Step 2: Run them and see them fail** (`bun test src/test/server-request-guard.test.ts`).
- [ ] **Step 3: Implement `src/server/request-guard.ts`.** Pure, no imports from the server. Parse Origin with `new URL` inside try/catch (invalid → 403).
- [ ] **Step 4: Run the unit tests and see them pass.**
- [ ] **Step 5: Write failing HTTP tests** in `src/test/server-request-guard-http.test.ts`, copying the server setup from `src/test/server-assets-upload.test.ts` (temp dir, `FileSystem`, `saveConfig`, `new BacklogServer(dir)`, `start(0, false)`, `getPort()`, `retry`). Use `fetch` with explicit headers:
  - `POST /api/tasks` with `Origin: https://evil.example` and a JSON body → 403, and no task file was created (check `GET /api/tasks` is still empty).
  - `POST /api/assets` with `Origin: https://evil.example` → 403.
  - `PUT /api/config` with `Origin: https://evil.example` → 403.
  - `POST /api/tasks` with `Origin: http://127.0.0.1:<port>` → 201.
  - `GET /api/tasks` with `Host: evil.example` → 421. If Bun's `fetch` overrides the `Host` header, use `node:http` `request()` with an explicit `headers.host` for this one test, and say so in the report.
  - `GET /` (SPA) and `GET /assets/...` with a good Host → still 200 (existing tests in `server-assets.test.ts` also prove this).
- [ ] **Step 6: Run them and see them fail.**
- [ ] **Step 7: Wire the guard in `src/server/index.ts`.** In `start()`, after the `routes` object is built and before `Bun.serve`, wrap every method handler of every route once, in a single loop (for example a small private `guardRoutes(routes)` that maps `{ path: { METHOD: handler } }` to handlers that call `checkRequest(req, port)` first). Also call the guard at the top of the `fetch` fallback, before the WebSocket upgrade. Use the actual bound port (the server may start on port 0 in tests — read it after `Bun.serve` returns, for example through a field the wrapped handlers read at request time). Do not change any handler body.
- [ ] **Step 8: Run both new test files, then the existing server tests** (`bun test src/test/server-*.test.ts`) — all must pass, which proves same-host traffic still works.
- [ ] **Step 9: Compiled binary smoke.** Run `bun run build && bun scripts/smoke-compiled-build.ts dist/backlog "$(node -p 'require("./package.json").version')"` and paste the last lines. It uses `127.0.0.1`, so it must still pass.
- [ ] **Step 10: Definition of done and commit.** Run `bunx tsc --noEmit && bun run check . && bun test`, then commit `fix(server): reject cross-site and rebinding requests to the local web server` with both trailers.

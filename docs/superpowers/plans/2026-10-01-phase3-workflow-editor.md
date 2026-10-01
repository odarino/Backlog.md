# Phase 3: Workflow Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Users add, rename, reorder, color, and remove statuses (board columns) from the web Settings page; a rename or remove rewrites the affected task files, safely and in one commit.

**Architecture:** A core module (`src/core/workflow.ts`) owns validation, usage counts, rename, and remove, with rollback on failure. Thin server routes call it, and `PUT /api/config` refuses to drop or rename existing statuses (only rename/remove may do that). In the web UI, a pure planner (`src/web/lib/workflow-plan.ts`) turns the edited rows into API calls, and `WorkflowEditor.tsx` renders the editor inside Settings. Status colors live in a new `status_colors` config map.

**Tech Stack:** Bun 1.3.14+ / TypeScript, React 19, Tailwind 4, Bun test + jsdom. No new dependencies (native HTML5 drag-and-drop, as `TaskCard.tsx` already uses).

**Spec:** `docs/superpowers/specs/2026-09-30-images-workflow-publish-design.md`, section 4.

## Global Constraints

- Read `MANIFESTO.md` before starting. Do not edit it.
- Biome: tabs, double quotes. `bun run check .` lints `*.ts` only; match surrounding style in `.tsx` by hand.
- No subtitles or helper text under headings or labels in the UI. Button labels, input placeholders, `aria-label`s, and error text are fine.
- Status name rules: trimmed, 1–40 characters, no `"`, `\`, tab, or line break; not `Draft` (any case/spacing); unique after normalization (lowercase, all whitespace removed — the same rule as `getCanonicalStatus` in `src/utils/status.ts`).
- A workflow has at least 2 statuses. The last status is the terminal ("done") status (`src/utils/terminal-status.ts`).
- Colors: `#rrggbb` hex, stored lowercase.
- Config key `status_colors`, written as a YAML flow map with JSON quoting, for example `status_colors: {"In Progress":"#f59e0b","Done":"#10b981"}`. Omitted when empty.
- A rename or remove rewrites `status:` in task files under `tasks/`, `completed/`, and `archive/tasks/`. Drafts are not touched (their status is always `Draft`). Only the status field changes. `onStatusChange` callbacks must NOT run for these rewrites.
- With `auto_commit` on, all rewritten task files plus `config.yml` go into one git commit.
- Tasks that exist only on other git branches are not rewritten (documented limit).
- A long-running MCP server keeps its old status list until it restarts (documented limit; its tool schemas are built at startup).
- Definition of done: `bunx tsc --noEmit`, `bun run check .`, `bun test`. Known unrelated failures: config-commands "column 0", cli-json-watch launcher kill, 2x cli-pipe-output delayed pipe reader; flaky under load: git hard-kill, content-store tests, board-tui-move, cli-dependency `--clear-deps`, server SPA fallback.
- Commits: subject `feat(workflow): <summary>` or `fix(workflow): <summary>`, blank line, then exactly:
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
  `Claude-Session: https://claude.ai/code/session_013yqnsg7HFt3E7RreoDQSUC`
  No `--no-verify`. Do not create backlog tasks. Commit nothing under `backlog/`.

## Changes from the spec, found during planning

1. **Drafts are skipped.** Their status is always the literal `Draft`, which is not a configured status.
2. **No `onStatusChange` callbacks.** The rewrite saves task files directly (`fs.saveTask` under `withTaskLock`) instead of `Core.updateTask`, which would fire the callback once per task.
3. **Completed and archived tasks need their own write path.** `updateTaskFromInput` only resolves active tasks, so the rewrite lists each folder and saves in place.
4. **`PUT /api/config` cannot drop or rename statuses.** Without this, a stale Settings form could delete a status that tasks still use. Rename and remove go only through their own endpoints.
5. **`GET /api/statuses/usage`** gives the delete dialog its task counts (the web app does not load completed or archived tasks).
6. **Statuses and `default_status` are now written with JSON quoting.** Today a status containing `"` produces broken YAML; validation also forbids `"`.
7. **Colors show on board column headers and in the task list status chip.** Board cards have no status chip today, so there is nothing to color there.
8. **Reorder has Move up / Move down buttons as well as drag-and-drop**, for keyboard users and for tests.

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/types/index.ts` | Modify | `BacklogConfig.statusColors?: Record<string, string>` |
| `src/file-system/operations.ts` | Modify | Parse and serialize `status_colors`; JSON-quote statuses and `default_status` |
| `src/test/config-status-colors.test.ts` | Create | Config round trip |
| `src/core/workflow.ts` | Create | Validation, usage counts, rename, remove, rollback, commit |
| `src/test/workflow-core.test.ts` | Create | Core tests |
| `src/server/index.ts` | Modify | 3 routes; `PUT /api/config` status rules |
| `src/test/server-workflow.test.ts` | Create | Route tests |
| `src/web/lib/api.ts` | Modify | `fetchStatusUsage`, `renameStatus`, `removeStatus`; keep server error text in `updateConfig` |
| `src/web/lib/workflow-plan.ts` | Create | Pure: rows ↔ config, client validation, plan of API calls |
| `src/web/lib/workflow-plan.test.ts` | Create | Planner tests |
| `src/web/components/WorkflowEditor.tsx` | Create | The editor UI |
| `src/web/components/Settings.tsx` | Modify | Render `WorkflowEditor`, reload after save |
| `src/test/web-workflow-editor.test.tsx` | Create | Component tests |
| `src/web/lib/status-colors.ts` | Create | Readable text color for a background |
| `src/web/components/TaskColumn.tsx`, `Board.tsx`, `TaskList.tsx`, `App.tsx` | Modify | Pass and use `statusColors` |
| `src/test/web-status-colors.test.tsx` | Create | Color rendering tests |

---

### Task 1: `status_colors` config key and safe status quoting

**Files:**
- Modify: `src/types/index.ts` (`BacklogConfig`, next to `defaultStatus?`)
- Modify: `src/file-system/operations.ts` (`parseConfig` ~`:2090`, its return literal ~`:2189-2218`, `serializeConfig` ~`:2221-2265`; reuse `extractConfigKeyYaml` ~`:96` and `readYamlKey`/`Bun.YAML.parse` ~`:181`)
- Test: `src/test/config-status-colors.test.ts`

**Interfaces:**
- Produces: `BacklogConfig.statusColors?: Record<string, string>` — parsed from `status_colors`; values kept as written (validation happens in core and server); non-string values and a non-map value are ignored (parse result `undefined`).

- [ ] **Step 1: Write the failing tests.** Use the temp-dir pattern from `src/test/server-assets-upload.test.ts` (`createUniqueTestDir`, `new FileSystem(dir)`, `ensureBacklogStructure()`, `saveConfig`, `safeCleanup`). Cases:

```ts
it("round-trips status_colors as a JSON-quoted flow map", async () => {
	const base = (await filesystem.loadConfig())!;
	await filesystem.saveConfig({ ...base, statuses: ["To Do", "In Progress", "Done"], statusColors: { "In Progress": "#f59e0b", Done: "#10b981" } });
	const text = await Bun.file(filesystem.configFilePath).text();
	expect(text).toContain('status_colors: {"In Progress":"#f59e0b","Done":"#10b981"}');
	const reloaded = await new FileSystem(TEST_DIR).loadConfig();
	expect(reloaded?.statusColors).toEqual({ "In Progress": "#f59e0b", Done: "#10b981" });
});

it("omits status_colors when empty or missing", async () => {
	const base = (await filesystem.loadConfig())!;
	await filesystem.saveConfig({ ...base, statusColors: {} });
	expect(await Bun.file(filesystem.configFilePath).text()).not.toContain("status_colors");
	expect((await new FileSystem(TEST_DIR).loadConfig())?.statusColors).toBeUndefined();
});

it("reads a block-style status_colors map written by hand", async () => {
	const path = filesystem.configFilePath;
	const text = await Bun.file(path).text();
	await Bun.write(path, `${text.trimEnd()}\nstatus_colors:\n  "To Do": "#64748b"\n  Done: "#10B981"\n`);
	expect((await new FileSystem(TEST_DIR).loadConfig())?.statusColors).toEqual({ "To Do": "#64748b", Done: "#10B981" });
});

it("ignores a malformed status_colors value", async () => {
	const path = filesystem.configFilePath;
	await Bun.write(path, `${(await Bun.file(path).text()).trimEnd()}\nstatus_colors: [1, 2]\n`);
	expect((await new FileSystem(TEST_DIR).loadConfig())?.statusColors).toBeUndefined();
});

it("writes statuses and default_status with JSON quoting", async () => {
	const base = (await filesystem.loadConfig())!;
	await filesystem.saveConfig({ ...base, statuses: ["To Do", "Wait: QA", "Done"], defaultStatus: "Wait: QA" });
	const text = await Bun.file(filesystem.configFilePath).text();
	expect(text).toContain('statuses: ["To Do", "Wait: QA", "Done"]');
	expect(text).toContain('default_status: "Wait: QA"');
	const reloaded = await new FileSystem(TEST_DIR).loadConfig();
	expect(reloaded?.statuses).toEqual(["To Do", "Wait: QA", "Done"]);
	expect(reloaded?.defaultStatus).toBe("Wait: QA");
});
```

If `default_status: "Wait: QA"` does not round-trip because the `parseConfig` line split takes only the text after the first colon, fix the `default_status` case to use the full remaining value of the line, and say so in the report.

- [ ] **Step 2: Run them and see them fail** (`bun test src/test/config-status-colors.test.ts`).
- [ ] **Step 3: Implement.**
  - Types: `statusColors?: Record<string, string>;`
  - Parse: a small private helper that calls `extractConfigKeyYaml(content, "status_colors")`, parses it with `Bun.YAML.parse` inside try/catch, and returns a `Record<string,string>` built from string entries only — or `undefined` when the key is missing, the value is not a plain object, or no entry is a string. Assign `config.statusColors` and add `statusColors: config.statusColors,` to the return literal.
  - Serialize: replace the `statuses` line with ``statuses: [${config.statuses.map((s) => JSON.stringify(s)).join(", ")}]``; replace the `default_status` line with ``default_status: ${JSON.stringify(config.defaultStatus)}``; add ``...(config.statusColors && Object.keys(config.statusColors).length > 0 ? [`status_colors: ${JSON.stringify(config.statusColors)}`] : [])`` next to `default_status`.
- [ ] **Step 4: Run the new tests and the existing config tests:** `bun test src/test/config-status-colors.test.ts src/test/config-commands.test.ts src/test/server-assets-upload.test.ts`. The known "column 0" failure in `config-commands.test.ts` predates this work; nothing else may fail.
- [ ] **Step 5: Commit** `feat(workflow): add status_colors config key and quote statuses safely`.

---

### Task 2: Core workflow module

**Files:**
- Create: `src/core/workflow.ts`
- Test: `src/test/workflow-core.test.ts`

**Interfaces:**
- Consumes: `BacklogConfig.statusColors` (Task 1); `Core` public members `fs: FileSystem`, `git: GitOperations`, `getContentStore()`, and `shouldAutoCommit(override?)` (check it is callable from outside; if it is private, make it public — no other change); `FileSystem.listTasks()`, `listCompletedTasks()`, `listArchivedTasks()`, `withTaskLock(task, fn)`, `saveTask(task)`, `loadConfig()`, `saveConfig(config)`, `configFilePath`; `GitOperations.addFiles(paths)`, `commitFiles(message, paths)`.
- Produces (all exported from `src/core/workflow.ts`):
  - `export class WorkflowError extends Error { readonly status: 400 | 404 | 409 }`
  - `export function statusKey(name: string): string` — `name.trim().toLowerCase().replace(/\s+/g, "")`
  - `export function validateStatusName(name: string): string` — returns the trimmed name or throws `WorkflowError(…, 400)`
  - `export function validateStatusList(statuses: string[]): string[]`
  - `export function validateStatusColors(colors: Record<string, string> | undefined, statuses: string[]): Record<string, string>` — keys mapped to the canonical status spelling, values lowercased; unknown status or bad hex → 400
  - `export async function countStatusUsage(core: Core): Promise<Record<string, number>>` — one entry per configured status (0 when unused), counting tasks in `tasks/`, `completed/`, `archive/tasks/` whose status matches by `statusKey`
  - `export interface WorkflowResult { config: BacklogConfig; changedTasks: number }`
  - `export async function renameStatus(core: Core, from: string, to: string, autoCommit?: boolean): Promise<WorkflowResult>`
  - `export async function removeStatus(core: Core, status: string, moveTo: string | undefined, autoCommit?: boolean): Promise<WorkflowResult>`

**Behavior (the tests below pin each line):**
- `renameStatus`:
  - `from` must match a configured status by `statusKey` → else 404 `Unknown status: <from>`.
  - `to` goes through `validateStatusName`.
  - If `to` matches a different configured status by `statusKey` → 409 `Status already exists: <that status>`. A case-only rename of the same status (`"in progress"` → `"In progress"`) is allowed.
  - `to === from` exactly → no-op: return `{ config, changedTasks: 0 }`, no writes, no commit.
  - Every task in the 3 folders whose status matches `from` by `statusKey` (including non-canonical spellings such as `todo` for `To Do`) gets `status = to`.
  - The config gets `to` in the same position. `defaultStatus` follows the rename. A `statusColors` entry for `from` moves to `to`.
- `removeStatus`:
  - The status must exist → else 404.
  - The config must keep at least 2 statuses → else 400 `A workflow needs at least 2 statuses`.
  - If tasks use the status:
    - `moveTo` is required → 400 `Choose a status for the <n> tasks that use <status>`.
    - `moveTo` must be another configured status → 400 `Unknown target status: <moveTo>`.
    - The matching tasks get `status = moveTo` (canonical spelling).
  - If no task uses the status, `moveTo` is ignored.
  - The config drops the status. If `defaultStatus` was the removed status, it becomes the first remaining status. The `statusColors` entry is dropped.
- Writes:
  - Each task is saved with `withTaskLock({ id, filePath })` → re-read that file → change only `status` → `fs.saveTask(task)` (`saveTask` keeps the existing `filePath`, so completed and archived tasks stay in their folders).
  - After the task writes, call `fs.saveConfig(nextConfig)`.
  - Then refresh the content store for the rewritten tasks, the same way `Core.writeTasksBulk` (`src/core/backlog.ts` ~`:2927`) does.
  - To re-read one task file by path, use the FileSystem parser that `listCompletedTasks`/`listArchivedTasks` use. Find it. If none is reachable, add the narrowest public method to `FileSystem` and say so in the report.
  - If `saveTask` also changes other fields (for example `updatedDate`), report it. Do not work around it without asking.
- Rollback: if any task write or the config save throws, restore the `status` of every task already rewritten (best effort, under its lock), leave the config as it was, and rethrow.
- Commit: if `core.shouldAutoCommit(autoCommit)` is true:
  - Run `git.addFiles(paths)` then `git.commitFiles(message, paths)`. `paths` is every rewritten task file plus `fs.configFilePath`.
  - The messages are ``Rename status "<from>" to "<to>"`` and ``Remove status "<status>"``. The remove message also gets `` (moved <n> tasks to "<moveTo>")`` when tasks moved.

- [ ] **Step 1: Write the failing tests.** Set up a temp project the way `src/test/core-autocommit-scope.test.ts` does: `createUniqueTestDir`, `new Core(dir)`, `ensureBacklogStructure()`, then `saveConfig` with `statuses: ["To Do", "In Progress", "Review", "Done"]`, `defaultStatus: "Review"`, `statusColors: { Review: "#8b5cf6" }`, `autoCommit: false`.
  - Create tasks with `core.createTaskFromInput({ title, status })`.
  - Make a completed task with `createTaskFromInput({ status: "Done" })` + `core.completeTask(id, false)`. For a completed task in another status, complete it first, then rewrite its file's `status:` line directly with `Bun.write`.
  - Make an archived task with `core.archiveTask(id, false)` on a non-terminal task.
  - Write a task file with the non-canonical status `review` the same way (direct `Bun.write`), to prove that normalization works.

  Tests:
  - `validateStatusName`:
    - Accepts `"  QA  "`, which comes back as `"QA"`.
    - Rejects `""`, a 41-character name, `'a"b'`, `"a\\b"`, `"a\nb"`, `"Draft"`, and `" draft "`. Each rejection is a `WorkflowError` with status 400.
  - `validateStatusList`:
    - Rejects `["Only"]`.
    - Rejects `["To Do", "todo"]` as a duplicate.
    - Accepts `["To Do", "Done"]`.
  - `validateStatusColors`:
    - Maps `{ review: "#8B5CF6" }` to `{ Review: "#8b5cf6" }`.
    - Rejects `{ Nope: "#000000" }` and `{ Review: "red" }`.
  - `countStatusUsage` returns `{ "To Do": n, "In Progress": n, Review: n, Done: n }`, with counts across all 3 folders. The non-canonical `review` file counts under `Review`.
  - `renameStatus(core, "Review", "QA")`:
    - Returns `changedTasks` equal to the Review count.
    - Every active, completed, and archived task that was in Review (including the `review` file) now reads `QA` from disk, in the same folder as before.
    - The config statuses are `["To Do", "In Progress", "QA", "Done"]`.
    - `defaultStatus` is `"QA"`, and `statusColors` is `{ QA: "#8b5cf6" }`.
    - The draft is unchanged.
  - `renameStatus` errors:
    - An unknown `from` gives 404.
    - `to = "done"` (an existing status, different case) gives 409.
    - A case-only rename `"In Progress" → "In progress"` succeeds.
    - `to === from` gives `changedTasks: 0`, and the config file text stays byte-identical.
  - `onStatusChange`:
    - Set `onStatusChange` in the config to a command that writes a marker file, for example `touch <dir>/called`. The command must be safe for the platform; on Windows CI, use a command that `src/test/status-callback.test.ts` already uses.
    - Rename a status that tasks use.
    - Assert that the marker file does not exist.
  - `removeStatus(core, "Review", "In Progress")`:
    - The tasks move to `In Progress`, and the config has 3 statuses.
    - `defaultStatus` becomes `"To Do"`, the first remaining status.
    - The color for Review is dropped.
  - `removeStatus` errors:
    - A used status without `moveTo` gives 400.
    - `moveTo` equal to the removed status, or an unknown status, gives 400.
    - With only 2 statuses left, removing one gives 400.
    - An unused status is removed without `moveTo`, with `changedTasks: 0`.
  - Rollback:
    - Make the config save fail. One way is to wrap `core.fs.saveConfig` with a function that throws, and restore it after the test.
    - Call `renameStatus` and expect it to reject.
    - Every task file still has its old status, and the config is unchanged.
  - Auto-commit:
    - In a git-initialized temp repo with `autoCommit: true` (copy the git setup from `src/test/core-autocommit-scope.test.ts`), run a rename.
    - Exactly one new commit exists. Its message is ``Rename status "Review" to "QA"``.
    - Its file list includes the rewritten task files from all folders and `backlog/config.yml`.

- [ ] **Step 2: Run them and see them fail** (`bun test src/test/workflow-core.test.ts`).
- [ ] **Step 3: Implement `src/core/workflow.ts`** to the behavior above. Keep it one file. Keep the folder-scan helper and the rewrite-with-rollback helper module-local.
- [ ] **Step 4: Run** `bun test src/test/workflow-core.test.ts src/test/status-callback.test.ts src/test/terminal-status.test.ts`.
- [ ] **Step 5: Commit** `feat(workflow): add core status rename and remove with rollback`.

---

### Task 3: Server routes and config rules

**Files:**
- Modify: `src/server/index.ts` (routes near `/api/statuses` ~`:446`; `handleUpdateConfig` ~`:1624-1671`; reuse `readOptionalJsonBody` ~`:1706`, `broadcastDataUpdated("tasks")` ~`:354`, `broadcastConfigUpdated()` ~`:371`)
- Test: `src/test/server-workflow.test.ts`

**Interfaces:**
- Consumes: everything Task 2 exports.
- Produces:
  - `GET /api/statuses/usage` → `200 Record<string, number>`
  - `POST /api/statuses/rename` body `{ from: string, to: string }` → `200 { config, changedTasks }`
  - `POST /api/statuses/remove` body `{ status: string, moveTo?: string }` → `200 { config, changedTasks }`
  - Errors: `WorkflowError` → `{ error }` with its status; a missing or non-string body field → 400 `{ error }`.
  - `PUT /api/config` additions:
    - When the body has `statuses`, run `validateStatusList` on it (400).
    - Every currently configured status must still be in the list with the exact same spelling. Otherwise return 409 `{ error: "Use rename or remove to change existing statuses" }`.
    - `defaultStatus`, if set, must be in the new list. Otherwise return 400.
    - `statusColors` goes through `validateStatusColors`. Save the normalized map.
  - After a successful rename or remove, call `broadcastDataUpdated("tasks")` and `broadcastConfigUpdated()`.

- [ ] **Step 1: Write the failing HTTP tests.** Copy the server harness from `src/test/server-assets-upload.test.ts` (temp dir, `saveConfig`, `new BacklogServer(dir)`, `start(0, false)`, `getPort()`, `retry`). Send requests with no `Origin` header, as the request guard allows. Cases:
  - Usage:
    - Create 2 tasks in `To Do` and 1 in `Done`.
    - `GET /api/statuses/usage` returns `{ "To Do": 2, "In Progress": 0, Done: 1 }`.
  - Rename:
    - `POST /api/statuses/rename {from:"In Progress", to:"Doing"}` returns 200.
    - `GET /api/statuses` then returns `["To Do","Doing","Done"]`.
    - A task that was in `In Progress` now reads `Doing` through `GET /api/tasks/<id>`.
  - Rename errors:
    - An unknown `from` returns 404.
    - `to: "done"` returns 409.
    - A body with no `to` returns 400.
    - `to: 'a"b'` returns 400.
  - Remove:
    - `POST /api/statuses/remove {status:"To Do", moveTo:"Done"}` returns 200.
    - The tasks now read `Done`.
    - Without `moveTo`, the same request returns 400 and the status still exists.
  - `PUT /api/config` rules:
    - Reorder plus add (`["Done","New","To Do","In Progress"]` → reordered, `New` added) returns 200.
    - Dropping `In Progress` returns 409, and the config is unchanged.
    - Renaming through PUT (`"In progress"`) returns 409.
    - A duplicate returns 400.
    - `statusColors: {"to do":"#AABBCC"}` is saved as `{"To Do":"#aabbcc"}`.
    - `statusColors: {"Nope":"#000000"}` returns 400.
    - A body with no `statuses` key keeps working, as the existing Settings save does.
  - Broadcast:
    - Open a WebSocket the way `src/test/server-milestone-broadcast.test.ts` does.
    - After a rename, the socket receives a `tasks-updated` message and a `config-updated` message.
    - If the existing message names differ, use the real names and say so in the report.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement** the routes and the `handleUpdateConfig` rules. Route handlers stay thin: parse the body, call core, map `WorkflowError`. Register `/api/statuses/usage`, `/api/statuses/rename`, and `/api/statuses/remove` as exact paths next to `/api/statuses`.
- [ ] **Step 4: Run** `bun test src/test/server-workflow.test.ts src/test/server-request-guard-http.test.ts src/test/server-assets-upload.test.ts`, then `bun test src/test/server-*.test.ts`.
- [ ] **Step 5: Commit** `feat(workflow): add status rename, remove, and usage endpoints`.

---

### Task 4: Workflow editor in Settings

**Files:**
- Modify: `src/web/lib/api.ts` (next to `fetchStatuses` ~`:426`, `updateConfig` ~`:462`; reuse `toApiError` ~`:127`)
- Create: `src/web/lib/workflow-plan.ts`, `src/web/lib/workflow-plan.test.ts`
- Create: `src/web/components/WorkflowEditor.tsx`
- Modify: `src/web/components/Settings.tsx` (Workflow section ~`:193`, above the Default Status block ~`:236`)
- Test: `src/test/web-workflow-editor.test.tsx`

**Interfaces:**
- Consumes: the Task 3 endpoints.
- Produces:
  - `apiClient.fetchStatusUsage(): Promise<Record<string, number>>`
  - `apiClient.renameStatus(from: string, to: string): Promise<{ config: BacklogConfig; changedTasks: number }>`
  - `apiClient.removeStatus(status: string, moveTo?: string): Promise<{ config: BacklogConfig; changedTasks: number }>`
  - `apiClient.updateConfig` now throws the server's `{ error }` text, using `toApiError(response, "Failed to update config")` instead of the generic `Error`. All 3 new methods must also surface the server's error text. If `fetchJson` loses it, use `fetch` plus `toApiError`, as `uploadAsset` does.
  - In `src/web/lib/workflow-plan.ts`:

```ts
export interface WorkflowRow {
	id: string; // stable React key, e.g. "s0", "new-1"
	original: string | null; // the saved name, or null for a new row
	name: string;
	color: string | null; // "#rrggbb" or null
}
export interface WorkflowRemoval {
	status: string; // saved name
	moveTo: string | null; // saved name of another status, or null when no task uses it
}
export interface WorkflowPlan {
	removals: WorkflowRemoval[];
	renames: Array<{ from: string; to: string }>;
	statuses: string[]; // final order, final names
	statusColors: Record<string, string>; // final names → color
}
export function rowsFromConfig(statuses: string[], colors: Record<string, string> | undefined): WorkflowRow[];
export function insertNewRow(rows: WorkflowRow[], name: string, id: string): WorkflowRow[]; // inserts before the last row
export function moveRow(rows: WorkflowRow[], index: number, delta: -1 | 1): WorkflowRow[];
export function validateRows(rows: WorkflowRow[]): string | null; // first problem as text, or null
export function buildWorkflowPlan(saved: string[], rows: WorkflowRow[], removals: WorkflowRemoval[]): WorkflowPlan | { error: string };
export function hasWorkflowChanges(saved: string[], savedColors: Record<string, string> | undefined, rows: WorkflowRow[], removals: WorkflowRemoval[]): boolean;
```

- Planner rules:
  - `validateRows` uses the same name rules and the same minimum of 2 statuses as the server. It uses its own copy of `statusKey`, because web code must not import `src/core`.
  - In `buildWorkflowPlan`, a rename goes in the plan when `original !== null` and `name !== original`.
  - A rename whose target matches by key another *saved* status (other than itself) returns `{ error: "Rename to an existing status name in a separate save" }`. This keeps every server call valid when the calls run in order.
  - The order is fixed: removals first, then renames, then one config update.

- Editor behavior (`WorkflowEditor`):
  - Props: `{ config: BacklogConfig; onSaved: () => void }`.
  - It loads `fetchStatusUsage()` once on mount.
  - It renders a list with one row per status. Each row has:
    - a drag handle, using native HTML5 drag and drop that calls `moveRow` (`draggable`, `onDragStart`, `onDragOver` with `preventDefault`, `onDrop`)
    - Move up and Move down buttons with `aria-label="Move <name> up"` and `aria-label="Move <name> down"`
    - `<input type="color" aria-label="Color for <name>">`; with no color set, show `#94a3b8` but keep `color: null` until the user changes it
    - a name `<input aria-label="Status name">`
    - a delete button with `aria-label="Delete <name>"`
  - The last row shows a `Done` badge.
  - Below the list is an "Add status" input (placeholder `New status`) with an **Add** button. It calls `insertNewRow`.
  - Delete:
    - If the row is new, or its saved status has usage 0, delete it at once. A saved row also adds `{status, moveTo: null}` to the removals.
    - Otherwise, open a `Modal` titled `Delete <name>`. Its body text is `<n> tasks use "<name>". Move them to:`. It has a `<select aria-label="Move tasks to">` listing the other saved statuses that are not already removed, and **Delete** and **Cancel** buttons.
    - Confirm records the removal with the chosen `moveTo` and removes the row.
  - A **Save workflow** button is disabled when `!hasWorkflowChanges(...)` or `validateRows(...) !== null`, or while saving. The validation text shows in a `role="alert"` line.
  - Save steps:
    1. `buildWorkflowPlan`. On `{error}`, show it and stop.
    2. Await each `removeStatus` in order, then each `renameStatus` in order.
    3. `const fresh = await apiClient.fetchConfig()`.
    4. `await apiClient.updateConfig({ ...fresh, statuses: plan.statuses, statusColors: plan.statusColors })`.
    5. Show `SuccessToast` "Workflow saved", then call `onSaved()`.
  - On any error: show the error text, call `onSaved()` so the UI reloads the real server state, and stop.

- Settings changes:
  - Render `<WorkflowEditor config={config} onSaved={reload} />` at the top of the Workflow section. `reload` re-runs the existing `loadConfig` and `loadStatuses`, so the page's own Save never sends a stale status list.
  - Give the editor a `key` derived from `config.statuses.join("|")`, so it resets after a reload.

- [ ] **Step 1: Write failing planner tests** in `src/web/lib/workflow-plan.test.ts`. Cases:
  - `rowsFromConfig` keeps order and colors.
  - `insertNewRow` inserts second-to-last.
  - `moveRow` swaps rows and clamps at the ends.
  - `validateRows` returns an error for: an empty name; `Draft`; a duplicate after normalization; a name with `"`; fewer than 2 rows. It returns null for a valid list.
  - `buildWorkflowPlan`:
    - A rename plus a reorder gives the right `renames` and `statuses`.
    - A removal is passed through.
    - Colors follow renamed names, and colors of removed rows are dropped.
    - A rename to another saved name (`"Review" → "Done"`) gives the error.
    - A case-only rename is allowed.
  - `hasWorkflowChanges` is false for untouched rows and true after any change, including only a color change.
- [ ] **Step 2: See them fail; implement `workflow-plan.ts`; see them pass.**
- [ ] **Step 3: Write failing component tests** in `src/test/web-workflow-editor.test.tsx`.
  - Copy the jsdom setup from `src/test/web-image-zoom-scope.test.tsx`.
  - Stub `apiClient.fetchStatusUsage`, `renameStatus`, `removeStatus`, `fetchConfig`, and `updateConfig`. Restore them in `afterEach`, and record their calls.
  - Render `WorkflowEditor` with `config.statuses = ["To Do","In Progress","Review","Done"]` and usage `{ "To Do": 2, "In Progress": 0, Review: 3, Done: 1 }`.
  - Cases:
    - The rows render in order. Only the last row shows `Done`. Save is disabled.
    - Rename `Review` to `QA` and click Move up on `QA`. Save is enabled. Click it. The calls are `renameStatus("Review","QA")` and then `updateConfig` with `statuses` `["To Do","QA","In Progress","Done"]`. `onSaved` is called once.
    - Delete `In Progress` (usage 0). No dialog opens. Save calls `removeStatus("In Progress", undefined)` before `updateConfig`.
    - Delete `Review` (usage 3). The dialog shows `3 tasks use "Review". Move them to:`. Choose `To Do` and confirm. Save calls `removeStatus("Review","To Do")`.
    - Add `Blocked`. It appears second-to-last. Save sends `updateConfig` with `Blocked` before `Done`, and makes no rename or remove call.
    - Type an empty name. The alert shows a message, and Save is disabled.
    - Make `renameStatus` reject with `new Error("Status already exists: Done")`. The alert shows that text, and `onSaved` is still called.
- [ ] **Step 4: See them fail; implement `WorkflowEditor.tsx`, the `api.ts` methods, and the `Settings.tsx` wiring; see them pass.**
- [ ] **Step 5: Run** `bun test src/web/lib/workflow-plan.test.ts src/test/web-workflow-editor.test.tsx src/web/lib/api-assets.test.ts && bunx tsc --noEmit && bun run check .`.
- [ ] **Step 6: Commit** `feat(workflow): add the workflow editor to Settings`.

---

### Task 5: Status colors on the board and task list

**Files:**
- Create: `src/web/lib/status-colors.ts`
- Modify: `src/web/App.tsx` (pass `config.statusColors` down; find where `Board` and `TaskList` are rendered), `src/web/components/Board.tsx` (`TaskColumn` renders ~`:884-934`), `src/web/components/TaskColumn.tsx` (header ~`:253-258`), `src/web/components/TaskList.tsx` (status chip ~`:917`, `getStatusColor` ~`:536-547`)
- Test: `src/test/web-status-colors.test.tsx`

**Interfaces:**
- Consumes: `BacklogConfig.statusColors` (Task 1).
- Produces:
  - `export function readableTextColor(hex: string): "#111827" | "#ffffff"`. It returns dark text when the background's relative luminance is above 0.5, and white text otherwise.
  - `export function statusColorFor(colors: Record<string, string> | undefined, status: string): string | null`. It matches by the normalized key (lowercase, whitespace removed). It returns the color or `null`.
  - The new optional prop `statusColors?: Record<string, string>` goes on `Board`, `TaskColumn` and `TaskList`.

- Rendering:
  - `TaskColumn` header: when the status has a color, render `<span aria-hidden="true" data-status-color className="inline-block h-2.5 w-2.5 rounded-circle" style={{ backgroundColor: color }} />` before the `<h3>` title. The count badge keeps its current classes.
  - `TaskList` status chip: when the status has a color, use an inline style `{ backgroundColor: color, color: readableTextColor(color) }` instead of the `getStatusColor` classes. Without a color, nothing changes.

- [ ] **Step 1: Write failing tests.**
  - Unit tests for `readableTextColor`:
    - `#ffffff` gives dark text.
    - `#000000` gives white text.
    - `#f59e0b` gives dark text.
    - `#1e3a8a` gives white text.
  - Unit tests for `statusColorFor`: `"in progress"` finds `"In Progress"`, and a missing status gives `null`.
  - jsdom render tests:
    - `TaskColumn` with `title="Review"` and `statusColors={{ Review: "#8b5cf6" }}` renders `[data-status-color]` with `background-color: #8b5cf6`, or the jsdom `rgb(...)` equivalent.
    - Without colors, `[data-status-color]` is not rendered.
    - Check `TaskColumn`'s required props first, and pass minimal values.
  - For `TaskList`, a render test is fine if the component can be rendered with small props. If it needs heavy context, test the chip style through an extracted pure function `statusChipStyle(colors, status)`, and say so in the report.
- [ ] **Step 2: See them fail; implement; see them pass.**
- [ ] **Step 3: Manual check (controller does it in a browser).** Implementers skip this step.
- [ ] **Step 4: Definition of done:** `bunx tsc --noEmit && bun run check . && bun test`.
- [ ] **Step 5: Commit** `feat(workflow): show status colors on board columns and the task list`.

---

## Notes for later phases

- Phase 4 README "Fork features" must mention:
  - the workflow editor
  - the MCP restart limit after a status rename
  - the other-branch limit

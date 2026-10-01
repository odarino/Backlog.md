# Clone Task — Design

Date: 2026-10-01
Fork: https://github.com/odarino/Backlog.md (`@odarino/backlog.md`)

## Goal

Copy an existing task into a new task: from the web UI (pre-filled create form), the CLI, and MCP.

## Non-goals

- Cloning archived tasks (other edit paths do not reach `archive/` either).
- Copying image files: the clone keeps the same `/assets/...` links, so both tasks show the same files.
- Bulk clone, clone with subtasks, cross-branch clone.

## Field rules

| Field | Clone value |
|-------|-------------|
| Title | `Copy of <title>`, unless a title override is given |
| Status | The configured default status (`default_status`, else the first status). If the source is a draft, the clone is a draft (`Draft`). |
| Description, implementation plan | Copied |
| Labels, priority, type, project, milestone, assignee | Copied |
| Dependencies, parent task | Copied (a cloned subtask becomes a sibling) |
| References, documentation, modified files | Copied |
| Acceptance criteria | Copied text, all unchecked |
| Definition of Done | Copied text, all unchecked, and no extra project defaults (`definitionOfDoneAdd` = the source texts, `disableDefinitionOfDoneDefaults: true`) |
| Due date, implementation notes, final summary, comments | Not copied |
| ID, created date, updated date, ordinal | New (assigned by the normal create path) |

## Architecture

- **`src/utils/task-clone.ts`** (pure, no file IO, importable from web code):
  `buildTaskCloneInput(task: Task, options: { title?: string; defaultStatus: string }): TaskCreateInput` applies the field rules.
- **`Core.cloneTask(taskId: string, options?: { title?: string }): Promise<Task>`** in `src/core/backlog.ts`: loads the source (active, completed, or draft), resolves the default status from config, builds the input, and calls the existing `createTaskFromInput`. ID allocation, the create lock, `onStatusChange` rules, and auto-commit therefore behave exactly like a normal create.
- **Web:** a **Clone** button in the `TaskDetailsModal` header (view mode, not for tasks from other branches). It opens the existing create form pre-filled from `buildTaskCloneInput`. Nothing is saved until **Create**.
- **CLI:** `backlog task clone <id> [--title <title>]`. It creates the clone at once and prints the new task ID (plain output) or the task (with `--plain`/JSON flags, if the existing task commands offer them).
- **MCP:** tool `task_clone` with input `{ id: string, title?: string }`. It returns the created task in the same format as `task_create`. The tool description states the field rules in one sentence.

## Errors

- An unknown or archived source ID gives the existing "task not found" error on each surface.
- A title override goes through the same title validation as `task create`.

## Tests

- Unit tests for `buildTaskCloneInput`: one per rule in the table, plus the draft case and the title override.
- A core test for `cloneTask`: new ID, unchecked items, a completed source, a draft source, an unknown ID.
- A CLI test for `task clone`, and an MCP test for `task_clone`.
- A web test: click Clone, the form shows the copied values, **Create** sends the expected payload, **Cancel** creates nothing.

## Docs

- The README "Fork features" list gets one entry for cloning.

# Clone Task Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** You can copy a task into a new task from the web UI (with a pre-filled create form), the CLI (`backlog task clone`), and MCP (`task_clone`).

**Architecture:**
- One pure mapper (`src/utils/task-clone.ts`) applies the field rules.
- `Core.cloneTask` loads the source and calls the existing `createTaskFromInput`.
- The CLI command and the MCP tool are thin wrappers around `Core.cloneTask`.
- The web modal gets a `prefill` prop for create mode and a **Clone** button.

**Tech Stack:** Bun + TypeScript, Commander (CLI), JSON-Schema MCP tools, React 19 web UI, Bun test + jsdom.

**Spec:** `docs/superpowers/specs/2026-10-01-task-clone-design.md`

## Global Constraints

- **Field rules:**
  - The title is `Copy of <title>`, unless an override is given.
  - The status uses the normal create default. If the source is a draft, the clone is a draft.
  - These fields are copied: description, implementation plan, labels, priority, type, project, milestone, assignee, dependencies, parent task, references, documentation, and modified files.
  - Acceptance criteria are copied with their text, all unchecked.
  - Definition of Done items are copied with their text, all unchecked, with no extra project defaults.
  - These fields are not copied: implementation notes, final summary, comments, ID, dates, and ordinal.
- **Image files** are not copied. Their links are copied unchanged.
- **Archived tasks** cannot be cloned. An unknown or archived ID gives a "task not found" error on every surface.
- **UI copy:** no subtitles or helper text.
- **Style:** Biome, with tabs and double quotes. Bun test runner.
- **Definition of done:** `bunx tsc --noEmit`, `bun run check .` and `bun test` all pass.
  - Known unrelated failures: config-commands "column 0", cli-json-watch launcher kill, 2x cli-pipe-output delayed pipe reader.
  - Flaky under load: git hard-kill, content-store tests, board-tui-move, cli-dependency `--clear-deps`, server SPA fallback.
- **Commits:** the subject is `feat(clone): <summary>` or `fix(clone): <summary>`. Then a blank line, then exactly these 2 lines:
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
  `Claude-Session: https://claude.ai/code/session_013yqnsg7HFt3E7RreoDQSUC`
  - Do not use `--no-verify`.
  - Do not create backlog tasks.
  - Never push.

## Changes from the spec, found during planning

1. **No `defaultStatus` parameter.** `createTaskFromInput` already applies `config.defaultStatus || FALLBACK_STATUS` when the status is empty. So the mapper leaves the status unset, except for drafts. The web create form keeps its existing status default.
2. **Drafts load through `core.filesystem.loadDraft(id)`.** `getTask` does not return drafts.
3. **The web create path drops some fields today.** The modal's create payload leaves out `references`, `modifiedFiles` and `parentTaskId`. The server create handler ignores `documentation`. The clone needs all 4, so Task 3 passes them through.

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/utils/task-clone.ts` | Create | Pure mapper `buildTaskCloneInput` |
| `src/test/task-clone.test.ts` | Create | Mapper + `Core.cloneTask` tests |
| `src/core/backlog.ts` | Modify | `Core.cloneTask` |
| `src/cli.ts` | Modify | `task clone` command |
| `src/mcp/tools/tasks/index.ts`, `handlers.ts`, `schemas.ts` | Modify | `task_clone` tool |
| `src/guidelines/mcp/overview.md`, `overview-tools.md` | Modify | List the new tool |
| `src/test/mcp-server.test.ts` | Modify | Tool list order |
| `src/test/cli-task-clone.test.ts`, `src/test/mcp-task-clone.test.ts` | Create | Surface tests |
| `src/web/components/TaskDetailsModal.tsx` | Modify | `prefill` prop, Clone button, create payload pass-through |
| `src/web/App.tsx` | Modify | Open the create modal with a prefill |
| `src/server/index.ts` | Modify | Pass `documentation` through on create |
| `src/test/web-task-clone.test.tsx` | Create | Web tests |
| `README.md` | Modify | One Fork features line |

---

### Task 1: Mapper and `Core.cloneTask`

**Files:** Create `src/utils/task-clone.ts`. Modify `src/core/backlog.ts` (add the method next to `createTaskFromInput`, ~:1758). Test: `src/test/task-clone.test.ts`.

**Interfaces:**
- Produces:
  - `export function buildTaskCloneInput(task: Task, options?: { title?: string }): TaskCreateInput`
  - `Core.cloneTask(taskId: string, options?: { title?: string }): Promise<{ task: Task; filePath?: string }>`. It has the same return shape as `createTaskFromInput`.
  - `Core.cloneTask` throws `new Error(\`Task not found: ${taskId}\`)` when no source exists.

- [ ] **Step 1: Write the failing mapper tests.** In `src/test/task-clone.test.ts`, build a full `Task` literal with every field set. Then check each of these:
  - Title is `Copy of X`, and an override wins.
  - `status` is `undefined` for a normal task and `"Draft"` for a source with status `Draft` (any case).
  - Copied fields are equal to the source: description, implementationPlan, labels, priority, type, project, milestone, assignee, dependencies, parentTaskId, references, documentation, modifiedFiles.
  - `acceptanceCriteria` is `[{text, checked:false}, …]` from `acceptanceCriteriaItems`, which may be checked in the source.
  - `definitionOfDoneAdd` is the list of source `definitionOfDoneItems` texts, and `disableDefinitionOfDoneDefaults` is `true`.
  - With no DoD items, `definitionOfDoneAdd` is `[]` and `disableDefinitionOfDoneDefaults` is still `true`, so the clone gets no defaults.
  - These keys are absent from the output: implementationNotes, finalSummary, ordinal, and every id or date field.
  - The output arrays are new arrays. Changing them does not change the source.

- [ ] **Step 2: Run the tests and see them fail.**

- [ ] **Step 3: Implement the mapper.**

```ts
import type { Task, TaskCreateInput } from "../types/index.ts";

/** Field rules for cloning a task; see docs/superpowers/specs/2026-10-01-task-clone-design.md. */
export function buildTaskCloneInput(task: Task, options: { title?: string } = {}): TaskCreateInput {
	const isDraft = (task.status ?? "").trim().toLowerCase() === "draft";
	return {
		title: options.title ?? `Copy of ${task.title}`,
		...(isDraft ? { status: "Draft" } : {}),
		description: task.description,
		implementationPlan: task.implementationPlan,
		labels: [...(task.labels ?? [])],
		priority: task.priority,
		type: task.type,
		project: task.project,
		milestone: task.milestone,
		assignee: [...(task.assignee ?? [])],
		dependencies: [...(task.dependencies ?? [])],
		parentTaskId: task.parentTaskId,
		references: task.references ? [...task.references] : undefined,
		documentation: task.documentation ? [...task.documentation] : undefined,
		modifiedFiles: task.modifiedFiles ? [...task.modifiedFiles] : undefined,
		acceptanceCriteria: (task.acceptanceCriteriaItems ?? []).map((item) => ({ text: item.text, checked: false })),
		definitionOfDoneAdd: (task.definitionOfDoneItems ?? []).map((item) => item.text),
		disableDefinitionOfDoneDefaults: true,
	};
}
```

  - If `priority` or `status` have narrower types than `string`, keep the source value's type. Do not cast to `any`.
  - If a copied key is `undefined`, it must stay `undefined`, as the tests expect. Do not drop such keys with a filter, unless a test forces that.

- [ ] **Step 4: Write the failing core tests** in the same file. Use the temp-project pattern from `src/test/workflow-core.test.ts`: `createUniqueTestDir`, `new Core(dir)`, `ensureBacklogStructure`, then `saveConfig` with `definitionOfDone: ["Tests pass"]` and `defaultStatus: "To Do"`.
  - **Normal source:** create the source with `createTaskFromInput` (status `In Progress`, 2 acceptance criteria with one checked, labels, `implementationNotes: "x"`). Then check `cloneTask(id)`:
    - It returns a new ID, not the source ID.
    - The title is `Copy of …`.
    - The status is `To Do`.
    - All acceptance criteria are unchecked.
    - The DoD items are exactly the source items, unchecked, so `Tests pass` appears once and is not duplicated.
    - There are no implementation notes.
  - **Completed source:** clone works on a completed source, created with `completeTask` after setting the terminal status.
  - **Draft source:** clone of a draft (`status: "Draft"`) gives a `DRAFT-` ID.
  - **Title override:** `cloneTask(id, { title: "Other" })` uses "Other".
  - **Not found:** an unknown ID rejects with `Task not found: <id>`.
  - **Archived source:** an archived source rejects the same way. Use `archiveTask` on a non-terminal task.

- [ ] **Step 5: Implement `Core.cloneTask`.**

```ts
	async cloneTask(taskId: string, options: { title?: string } = {}): Promise<{ task: Task; filePath?: string }> {
		const source = (await this.fs.loadDraft(taskId)) ?? (await this.getTask(taskId));
		if (!source) throw new Error(`Task not found: ${taskId}`);
		return await this.createTaskFromInput(buildTaskCloneInput(source, options));
	}
```

  - Check that `getTask` does not return archived tasks. If it does, reject a source whose `source` field or `filePath` shows the archive folder.
  - Also check whether `loadDraft` throws for a non-draft ID. If it does, call it only when `isDraftId(taskId)` is true (`src/utils/task-id.ts`).
  - Add the `buildTaskCloneInput` import.

- [ ] **Step 6: Run** `bun test --timeout=10000 src/test/task-clone.test.ts`, then `bunx tsc --noEmit && bun run check .`.

- [ ] **Step 7: Commit** with the message `feat(clone): add the clone mapper and Core.cloneTask`.

---

### Task 2: CLI command and MCP tool

**Files:**
- Modify: `src/cli.ts` (next to `task create`, ~:1897-2110).
- Modify: `src/mcp/tools/tasks/index.ts`, `handlers.ts`, `schemas.ts`.
- Modify: `src/guidelines/mcp/overview.md` (~:35-36) and `src/guidelines/mcp/overview-tools.md` (~:24).
- Modify: `src/test/mcp-server.test.ts` (~:280-300).
- Create: `src/test/cli-task-clone.test.ts` and `src/test/mcp-task-clone.test.ts`.

**Interfaces:** consumes `Core.cloneTask` from Task 1.

**CLI requirements:**
- The command is `backlog task clone <id> [--title <title>] [--plain]`. Register it with `addHelpSchema(taskCmd.command("clone <id>"), {...})`. Fill in `required`, `optional`, `writes`, `output` and `examples` the same way `create` does.
- **Success output:**
  - Default: `Created task <ID>` and then `File: <path>`. For a draft, print `Created draft <ID>` instead.
  - With `--plain`: `formatTaskPlainText(await loadTaskDetail(core, task), { filePathOverride: filePath })`.
- **Errors:** print the message to stderr and set `process.exitCode = 1`. This includes `Task not found: <id>` and an empty `--title`, which must fail with the same message as `task create` with an empty title.
- **Tests:** use the subprocess harness from `src/test/cli-plain-create-edit.test.ts`. Cover:
  - clone of TASK-1 prints `Created task TASK-2`, and the new file title starts with `Copy of`
  - `--title` sets the title
  - `--plain` shows `Task TASK-2 - Copy of …`
  - an unknown ID exits with code 1
  - clone of a draft prints `Created draft`

**MCP requirements:**
- **Schema.** Add `taskCloneSchema` to `schemas.ts`:

```ts
{
	type: "object",
	properties: {
		id: { type: "string", minLength: 1, maxLength: 50 },
		title: { type: "string", minLength: 1, maxLength: 200 },
	},
	required: ["id"],
	additionalProperties: false,
}
```

  Check the title `maxLength` that `task_create` uses, and use the same value.
- **Handler.** Add `async cloneTask(args: { id: string; title?: string }): Promise<CallToolResult>`. It calls `core.cloneTask` and returns `formatTaskCallResult(await loadTaskDetail(this.core, task), [\`Cloned ${args.id} to ${task.id}.\`])`.
  - Map "Task not found" to `BacklogToolError(msg, "TASK_NOT_FOUND")`.
  - Map other errors the same way `createTask` does.
- **Registration.** Register `task_clone` right after `task_create`.
  - Description: "Copy a task into a new task: copies the content, labels, links and checklists (unchecked); resets status, notes, summary and comments".
  - Annotations: `{ title: "Clone Task", destructiveHint: false }`.
- **Tool list test.** In `src/test/mcp-server.test.ts`, insert `task_clone` after `task_create`.
- **Docs.** Add one line for `task_clone` to `overview.md` and to the tool list in `overview-tools.md`, in the same style as the other lines.
- **Tests.** Use the harness from `src/test/mcp-tasks.test.ts`. Cover:
  - a clone returns text that contains `Cloned TASK-1 to TASK-2.` and `Task TASK-2 - Copy of …`
  - a title override works
  - an unknown ID gives an error result. Check the error format that `task_view` returns for an unknown ID, and assert the same format.

- [ ] **Step 1:** Write the CLI and MCP tests, and update the tool-list test. Run them and see them fail.
- [ ] **Step 2:** Implement the CLI command, the schema, the handler, the registration and the docs.
- [ ] **Step 3:** Run these tests:
  `bun test --timeout=10000 src/test/cli-task-clone.test.ts src/test/mcp-task-clone.test.ts src/test/mcp-server.test.ts src/test/mcp-tasks.test.ts`
  Then run `bunx tsc --noEmit && bun run check .`.
- [ ] **Step 4:** Commit with the message `feat(clone): add backlog task clone and the task_clone MCP tool`.

---

### Task 3: Web Clone button and README

**Files:**
- Modify: `src/web/components/TaskDetailsModal.tsx`. The relevant parts are: props (~:25-46), `buildTaskDetailsFormState` (~:109-141), the `useState` calls (~:227-252, ~:391-405), the reset effect (~:540-646), the dirty `baseline` (~:458), `buildDefinitionOfDoneCreatePayload` (~:721), `handleSave` (~:810-856), and the header `actions` (~:1146-1212).
- Modify: `src/web/App.tsx`. The relevant parts are: the modal state union (~:198-211), `handleNewTask` (~:517), and the render (~:1074).
- Modify: `src/server/index.ts`, in `handleCreateTask` (~:1104-1168).
- Modify: `README.md`, in the Fork features list.
- Create: `src/test/web-task-clone.test.tsx`.

**Interfaces:** consumes `buildTaskCloneInput` from Task 1. Import it from `'../../utils/task-clone'`, the same way App.tsx imports `../utils/task-id`.

**Requirements:**

1. **Server.** In `handleCreateTask`, pass `documentation: Array.isArray(payload.documentation) ? payload.documentation : undefined` to `createTaskFromInput`. Use the same style as `references`.

2. **Modal `prefill` prop.**
   - Add `prefill?: TaskCreateInput` to the props. It is used only in create mode, when `task` is undefined.
   - In create mode, the form starts from `prefill` instead of the empty defaults. Set these fields:
     - title, description, implementationPlan
     - labels, priority, type, project, milestone, assignee, dependencies
     - acceptance criteria: the `prefill.acceptanceCriteria` items, unchecked
     - Definition of Done: exactly the `prefill.definitionOfDoneAdd` texts, so the config defaults are not used
     - references, modifiedFiles, documentation
     - a hidden `parentTaskId`
   - The status stays at the existing create default. When `prefill.status === "Draft"`, the App opens draft mode instead (see point 4).
   - Apply the prefill in `buildTaskDetailsFormState` and in the reset effect, so that opening and closing the modal behaves the same as for a plain create.
   - Make the dirty-check `baseline` use the prefilled values. Cancel must not ask "Discard unsaved changes?" when the user changed nothing.

3. **Create payload.** In `handleSave` in create mode, add `references`, `modifiedFiles` and `documentation` from state, and `parentTaskId` from the prefill. Send the Definition of Done as follows:
   - If a prefill is set, send `definitionOfDoneAdd = <current DoD texts>` with `disableDefinitionOfDoneDefaults: true`.
   - Without a prefill, keep `buildDefinitionOfDoneCreatePayload()` exactly as it is today.
   - A plain create must send the same payload as before, except that `references` and `modifiedFiles` are now included. Check this with an existing create test, or add one.

4. **App wiring.**
   - Add `prefill?: TaskCreateInput` to the `{kind:'create'}` member of the union.
   - Add the handler `handleCloneTask(task: Task)`: `setModal({ kind: 'create', isDraft: (task.status ?? '').toLowerCase() === 'draft', prefill: buildTaskCloneInput(task) })`.
   - Pass `prefill={modal.kind === 'create' ? modal.prefill : undefined}` and `onClone={handleCloneTask}` to `TaskDetailsModal`.

5. **Clone button.**
   - Add the prop `onClone?: (task: Task) => void`.
   - In the header actions, when `mode === "preview" && !isCreateMode && !isFromOtherBranch && onClone`, render `<button type="button" onClick={() => onClone(task)} title="Clone">Clone</button>` before the Edit button. Use the same classes as the Edit button.

6. **README.** Add this bullet to "Fork features", after the Workflow editor bullet: `- **Clone task.** Copy a task into a new one from the task view (**Clone**), the CLI (\`backlog task clone <id> [--title <title>]\`), or MCP (\`task_clone\`). The copy keeps the content, labels, links, and checklists (unchecked), and resets the status, notes, summary, and comments.`

**Tests** (`src/test/web-task-clone.test.tsx`). Use the jsdom harness from `src/test/web-task-details-image-zoom.test.tsx`, and stub `apiClient.createTask`. Cover these cases:
- **Prefill in create mode.** Render `TaskDetailsModal` in create mode with `prefill` built from a source task with 2 acceptance criteria (one checked) and 1 DoD item. The title input shows `Copy of …`. The acceptance criteria show unchecked. The DoD shows the source item and not the config defaults. Click **Create**. The `onSubmit` payload holds:
  - `title`
  - `acceptanceCriteriaItems` with every item `checked: false`
  - `definitionOfDoneAdd: [<source text>]` and `disableDefinitionOfDoneDefaults: true`
  - `references`, `modifiedFiles`, `documentation` and `parentTaskId`
- **Cancel.** Clicking Cancel calls no create, and shows no confirm prompt when nothing changed.
- **Clone button in view mode.** Render the modal in view mode with `onClone`. Clicking **Clone** calls `onClone` with the task. The button is absent for a task with `branch` set, which means the task is from another branch.
- **App-level test (optional).** If a test can render the App with a task, Clone opens the create modal with the copied title. If the App harness is too heavy, skip this test and explain why in the report.

- [ ] **Step 1:** Write the web tests. Run them and see them fail.
- [ ] **Step 2:** Implement points 1-5 of the requirements.
- [ ] **Step 3:** Run these tests:
  `bun test --timeout=10000 src/test/web-task-clone.test.tsx src/test/web-task-details-image-zoom.test.tsx src/test/web-task-details-modal-keyboard-shortcuts.test.tsx src/test/web-task-readiness-badge.test.tsx`
  Then run `bunx tsc --noEmit && bun run check .`.
- [ ] **Step 4:** Add the README line (point 6).
- [ ] **Step 5:** Run the definition of done: `bun test`.
- [ ] **Step 6:** Commit with the message `feat(clone): clone a task from the web task view`.

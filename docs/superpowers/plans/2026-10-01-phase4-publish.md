# Phase 4: Publish as `@odarino/backlog.md` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The fork builds and publishes itself to npm as `@odarino/backlog.md` plus 6 scoped platform packages from a `v*.*.*` tag, with a README that documents the fork's features and limits.

**Architecture:** Rename every package reference in one place per file (package.json, the 3 launcher scripts, the release workflow). The release workflow authenticates with an `NPM_TOKEN` secret and keeps provenance. A guard test keeps unscoped names and upstream URLs from coming back. A flaky upstream test is fixed so CI stays green.

**Tech Stack:** GitHub Actions, npm 11.6, Bun 1.3.14 (CI), Node 24, Bun test.

**Spec:** `docs/superpowers/specs/2026-09-30-images-workflow-publish-design.md`, section 5.

## Global Constraints

- Main package: `@odarino/backlog.md`. Platform packages: `@odarino/backlog.md-{linux,darwin,windows}-{x64,arm64}`. The command stays `backlog`.
- Repository URL: `https://github.com/odarino/Backlog.md` (git form `git+https://github.com/odarino/Backlog.md.git`). Issues: `https://github.com/odarino/Backlog.md/issues`. Homepage: `https://github.com/odarino/Backlog.md#readme`.
- First fork release version: `1.54.0`.
- Every `npm publish` runs with `--access public --provenance` and `NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}`; `actions/setup-node` gets `registry-url: https://registry.npmjs.org`.
- Keep the MCP server name (`src/utils/app-info.ts` returns `"backlog.md"`) and the git lock directory name (`src/file-system/operations.ts:645`) unchanged: they are identities, not package names.
- Keep upstream credit: the README says this is a fork of `MrLesk/Backlog.md` and links to it; LICENSE is unchanged.
- Out of scope: Nix flake, the backlog.md website, Homebrew, TUI update checks.
- Definition of done: `bunx tsc --noEmit`, `bun run check .`, `bun test`. Known unrelated failures: config-commands "column 0", cli-json-watch launcher kill, 2x cli-pipe-output delayed pipe reader; flaky under load: git hard-kill, content-store tests, board-tui-move, cli-dependency `--clear-deps`, server SPA fallback.
- Commits: subject `chore(release): <summary>`, `fix(test): <summary>`, or `docs: <summary>`, blank line, then exactly:
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
  `Claude-Session: https://claude.ai/code/session_013yqnsg7HFt3E7RreoDQSUC`
  No `--no-verify`. Do not create backlog tasks. Never push or tag (the controller does that after asking the user).

## Facts found during planning

1. The fork has no workflow runs yet, although `main` was pushed 3 times: GitHub keeps workflows disabled on a fork until the owner enables them once in the Actions tab.
2. The fork has no repository secrets, so `NPM_TOKEN` must be added before the first release.
3. The release workflow currently relies on npm trusted publishing (OIDC). Trusted publishing can only be configured for packages that already exist on npm, so the first release of 7 new package names needs a token. Trusted publishing can be enabled later, per package.
4. The scope `@odarino` already exists (`@odarino/haren@1.1.3`), and `@odarino/backlog.md` is free.

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `package.json` | Modify | Name, version, repository, bugs, homepage, optionalDependencies |
| `scripts/resolveBinary.cjs` | Modify | Scoped platform package name |
| `scripts/postuninstall.cjs` | Modify | Scoped platform package list |
| `scripts/cli.cjs` | Modify | Install hints in error messages |
| `src/test/resolveBinary.test.ts` | Modify | Expect scoped names |
| `.github/workflows/release.yml` | Modify | Scoped names, token auth, provenance, fork URLs |
| `src/test/release-config.test.ts` | Create | Guard: no unscoped names or upstream URLs in release surfaces; names consistent |
| `src/test/web-dependency-cleanup-notice.test.tsx` | Modify | Stop the leaked refresh after teardown |
| `README.md` | Modify | Fork features section, install command, badges |

---

### Task 1: Rename the package and the platform packages

**Files:** `package.json`, `scripts/resolveBinary.cjs`, `scripts/postuninstall.cjs`, `scripts/cli.cjs`, `src/test/resolveBinary.test.ts`, create `src/test/release-config.test.ts`

- [ ] **Step 1: Update the existing tests first.** In `src/test/resolveBinary.test.ts`, change every expected `backlog.md-<platform>-<arch>` to `@odarino/backlog.md-<platform>-<arch>`, and every resolver path expectation accordingly (for example `@odarino/backlog.md-darwin-arm64/backlog`).
- [ ] **Step 2: Write the guard test** `src/test/release-config.test.ts`:

```ts
import { describe, expect, it } from "bun:test";

const SCOPE = "@odarino/backlog.md";
const PLATFORMS = ["linux-x64", "linux-arm64", "darwin-x64", "darwin-arm64", "windows-x64", "windows-arm64"];
const read = (path: string) => Bun.file(path).text();

describe("release configuration", () => {
	it("names the scoped main package and its platform packages", async () => {
		const pkg = await Bun.file("package.json").json();
		expect(pkg.name).toBe(SCOPE);
		expect(Object.keys(pkg.optionalDependencies).sort()).toEqual(PLATFORMS.map((p) => `${SCOPE}-${p}`).sort());
		expect(pkg.repository.url).toBe("git+https://github.com/odarino/Backlog.md.git");
		expect(pkg.bugs.url).toBe("https://github.com/odarino/Backlog.md/issues");
		expect(pkg.homepage).toBe("https://github.com/odarino/Backlog.md#readme");
		expect(pkg.bin).toEqual({ backlog: "scripts/cli.cjs" });
	});

	it("lists the same platform packages in the uninstall script", async () => {
		const text = await read("scripts/postuninstall.cjs");
		for (const platform of PLATFORMS) expect(text).toContain(`"${SCOPE}-${platform}"`);
	});

	it("keeps unscoped package names and upstream URLs out of the release surfaces", async () => {
		for (const path of ["scripts/resolveBinary.cjs", "scripts/postuninstall.cjs", "scripts/cli.cjs", ".github/workflows/release.yml"]) {
			const text = await read(path);
			// An unscoped platform package name is "backlog.md-<os>" not preceded by "@odarino/".
			expect(text.match(/(?<!@odarino\/)backlog\.md-(linux|darwin|windows)/g) ?? []).toEqual([]);
			expect(text).not.toContain("github.com/MrLesk/Backlog.md");
			expect(text).not.toMatch(/npm i(nstall)? -g backlog\.md\b/);
		}
	});
});
```

The third test reads `.github/workflows/release.yml`, so it fails until Task 2 is done. In this task, run only the first 2 tests of this file by name: `bun test src/test/release-config.test.ts -t "names the scoped" -t "uninstall script"`. If `-t` takes one pattern only, run them one at a time.

- [ ] **Step 3: Run the tests and see them fail:** `bun test src/test/resolveBinary.test.ts` and the 2 named guard tests.
- [ ] **Step 4: Implement.**
  - `package.json`:
    - `"name": "@odarino/backlog.md"` and `"version": "1.54.0"`.
    - `repository.url`, `bugs.url` and `homepage` get the values from Global Constraints.
    - Rename the 6 `optionalDependencies` keys to the scoped names, and keep their values (`"*"`).
    - Do not touch `bin`, `scripts`, or the dependency lists.
  - `scripts/resolveBinary.cjs`: `return \`@odarino/backlog.md-${platform === "win32" ? "windows" : platform}-${arch}\`;`
  - `scripts/postuninstall.cjs`: change the 6 list entries to the scoped names.
  - `scripts/cli.cjs`:
    - Change the hints to `arch -arm64 npm i -g @odarino/backlog.md` and `arch -arm64 bun add -g @odarino/backlog.md`.
    - Change "Reinstall backlog.md so…" to "Reinstall @odarino/backlog.md so…".
    - Remove the Homebrew line, because the fork does not publish to Homebrew.
    - Change the "More details" URL to `https://github.com/odarino/Backlog.md#apple-silicon-macos`. If the README has no such anchor, use `https://github.com/odarino/Backlog.md#readme`.
  - Run `bun install` so that `bun.lock` records the new name. Check `git diff bun.lock`: only the root package name or the workspace entry may change, and `"configVersion": 1` stays. If `bun install` changes anything else, report it and revert those lines.
- [ ] **Step 5: Run** the resolveBinary tests and the 2 named guard tests. Then run `bunx tsc --noEmit && bun run check .`.
- [ ] **Step 6: Commit** `chore(release): publish as @odarino/backlog.md with scoped platform packages`.

---

### Task 2: Release workflow for the fork

**Files:** `.github/workflows/release.yml`

- [ ] **Step 1: Run the third guard test and see it fail:** `bun test src/test/release-config.test.ts`.
- [ ] **Step 2: Edit `release.yml`.**
  - Add `NPM_SCOPE: "@odarino"` to the top-level `env:`, next to `BUN_VERSION`.
  - `publish-binaries` matrix: set `package: ${{ '@odarino/backlog.md-linux-x64' }}` and so on for all 6 entries. Plain strings are fine: `package: "@odarino/backlog.md-linux-x64"`.
  - Change both inline `"repository"` url values (the jq line in `npm-publish` and the heredoc in `publish-binaries`) to `https://github.com/odarino/Backlog.md`.
  - In both publish jobs, give `actions/setup-node@v6` a `registry-url: https://registry.npmjs.org`. Rename the "Configure npm for trusted publishing" steps to "Configure npm". Keep the `npm install -g npm@11.6.0`.
  - On every `npm publish` step, both the dry runs and the real runs, add `env: NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}` and the flag `--provenance`, so the command reads `npm publish --access public --provenance`. Keep `--dry-run` on the dry-run steps.
  - Add a first step to `npm-publish` and to `publish-binaries` that fails early with a clear message when the secret is missing:

```yaml
      - name: Require NPM_TOKEN
        shell: bash
        env:
          NPM_TOKEN: ${{ secrets.NPM_TOKEN }}
        run: |
          if [ -z "$NPM_TOKEN" ]; then
            echo "::error::Add the NPM_TOKEN repository secret (an npm granular token with publish rights for @odarino/*)."
            exit 1
          fi
```

  - `verify-platform-packages` and `install-sanity`:
    - Build package names with the `@odarino/` prefix. In the `node -e` one-liners, change `` `backlog.md-${platform}-${arch}` `` to `` `@odarino/backlog.md-${platform}-${arch}` ``.
    - The bash list of 6 names gets the scoped names.
    - In PowerShell, use `$PackageName = "@odarino/backlog.md-windows-$Arch"` and `$ExpectedPackage = "@odarino/backlog.md-windows-$Arch"`.
    - Change `npm i "backlog.md@${VERSION}"` to `npm i "@odarino/backlog.md@${VERSION}"`, in bash and in PowerShell, with the matching echo and throw texts.
  - `sync-version`: no change needed. It edits only `.version`.
  - Search the whole file for `backlog.md` after the edit. The only remaining matches must be the scoped names, artifact names such as `backlog-${{ matrix.target }}`, and binary file names.
- [ ] **Step 3: Validate the YAML.** Run `bunx --bun js-yaml .github/workflows/release.yml > /dev/null`, or parse it with `Bun.YAML.parse` in a one-line `bun -e`. If `actionlint` is on PATH, also run `actionlint .github/workflows/release.yml` and fix what it reports. If it is not installed, say so in the report.
- [ ] **Step 4: Run** `bun test src/test/release-config.test.ts`. Expected: 3 pass.
- [ ] **Step 5: Commit** `chore(release): publish the fork with an npm token and provenance`.

---

### Task 3: Fix the leaked refresh in `web-dependency-cleanup-notice.test.tsx`

**Files:** `src/test/web-dependency-cleanup-notice.test.tsx` (test-only; do not change `src/web/App.tsx` unless the fix needs a real product bug fixed — then stop and report first)

**Background (from the phase 3 reviews):**
- The third test ("warns that an archive moved before starting a refresh that can fail") returns as soon as the alert shows.
- The refresh it started is still running. `failRefreshSearch` makes the search throw. `refreshTasksData` then goes to its catch branch and runs the `await loadAllData()` retry (`App.tsx` ~:699).
- `afterEach` restores `fetch` and `Event`, but not `globalThis.window`. The late `fetchStatuses` uses the real `fetch` with a relative URL ("fetch() URL is invalid"). After that, `App.tsx` ~:711 dispatches a Bun `Event` on a JSDOM window.
- Bun reports the error against whichever test is running at that moment. It shows up as "Unhandled error between tests" in the full suite.

- [ ] **Step 1: Reproduce.** Run `bun test --timeout=10000 src/test/web-dependency-cleanup-notice.test.tsx src/test/workflow-core.test.ts src/test/server-workflow-git.test.ts` up to 5 times. Record whether an unhandled error appears. The leak depends on timing, so also run the full suite once and grep for "Unhandled error between tests". Record the evidence.
- [ ] **Step 2: Fix it in the test.**
  - Make the third test wait until the retry has settled before it returns. For example, wait until the stubbed `fetch` has seen the retry's requests, or until a flag set by the stub after the last expected call is true. Add a bounded timeout, so the test cannot hang.
  - In addition, make `afterEach` dispose safely. Set a `disposed` flag that the fetch stub checks: after teardown it returns a never-settling promise, or a harmless response. Then close the JSDOM window.
  - Do not weaken any assertion.
- [ ] **Step 3: Verify.** The file passes alone. The Step 1 command shows no unhandled error in 5 runs. One full-suite run shows no "Unhandled error between tests" that traces back to `App.tsx` from this file. Paste the evidence.
- [ ] **Step 4: Commit** `fix(test): wait for the dependency-cleanup refresh to settle before teardown`.

---

### Task 4: README fork section

**Files:** `README.md`

- [ ] **Step 1: Edit the top of the README.**
  - Keep the logo and the title, and change the npm badges to point at `@odarino/backlog.md`:
    - `https://www.npmjs.com/package/@odarino/backlog.md`
    - `https://img.shields.io/npm/v/@odarino/backlog.md?color=brightgreen`
    - `https://img.shields.io/npm/dm/@odarino/backlog.md`
  - Keep the license and stars badges. Point them at `odarino/Backlog.md`.
  - Change the install line to `<code>npm i -g @odarino/backlog.md</code>`.
  - Right after the install line, add the section below, verbatim apart from formatting fixes Biome or markdown needs:

```markdown
## About this fork

This is a fork of [MrLesk/Backlog.md](https://github.com/MrLesk/Backlog.md) with extra web UI features. The command is still `backlog`.

> **Note:** Do not install this package and the original `backlog.md` globally at the same time. Both provide the `backlog` command. Uninstall one first: `npm uninstall -g backlog.md`.

### Fork features

- **Image zoom.** Click an image in a task, a document, or a decision to open it full screen. Zoom with the mouse wheel, a double-click, or a pinch. Drag to pan. Use the arrow keys to move between all images of the task.
- **Image upload, paste, and drag-drop.** Paste a screenshot or drop image files into any task editor. The server compresses each image to WebP and saves it under `backlog/assets/images/<task-id>/`. Images that you add before a task has an ID go to `_unsorted/`, and they move to the task folder when you create the task.
- **Image picker.** The image button in the editor toolbar opens a picker. Search, select, and insert existing images, or upload new ones.
- **Workflow editor.** In Settings, add, rename, reorder, color, and delete statuses. A rename or delete rewrites the affected tasks in `tasks/`, `completed/`, and `archive/`. Status colors show on the board columns and in the task list.
- **Safer local server.** The web server rejects requests from other websites and DNS rebinding.

### Configuration

| Key | Default | Range | Purpose |
|-----|---------|-------|---------|
| `image_max_dimension` | `1920` | 256–8192 | The longest side of a compressed image, in pixels |
| `image_quality` | `0.8` | 0.1–1.0 | WebP quality |
| `status_colors` | none | `#rrggbb` per status | Status colors, for example `{"Done":"#10b981"}` |

### Limits

- Images over 50 megapixels are rejected. Shrink them first.
- GIF, SVG, and AVIF images are saved unchanged.
- With `auto_commit` on, a rename or delete of a status makes one commit for the task files and `config.yml`. A Settings save also commits `config.yml`.
- A running MCP server keeps the old status names until it restarts.
- Tasks that exist only on other git branches are not rewritten when you rename or delete a status.
- Two processes that change the workflow at the same moment can still conflict. Reload and try again.
- The web UI accepts only `http://127.0.0.1:<port>` and `http://localhost:<port>`. Access through a tunnel or a proxy is blocked.
```

  - Leave the rest of the README unchanged.
- [ ] **Step 2: Check.**
  - `bun run check .` must pass. Markdown is not linted, so only confirm that nothing else changed.
  - Read the rendered section once, with `cat`, to catch broken tables.
  - Confirm every claim against the code:
    - the config keys, their defaults, and their ranges (`src/core/image-compress.ts`, `src/server/index.ts`)
    - the 50 MP limit (`MAX_IMAGE_PIXELS`)
    - the folders
    - the request guard host rules (`src/server/request-guard.ts`)

  If any claim does not match, fix the README, not the code, and report it.
- [ ] **Step 3: Commit** `docs: document the fork features, configuration, and limits`.

---

### Task 5: Release (controller and user; no implementer)

1. The controller runs the full definition of done on `main` after merging.
2. **The user does these steps:**
   - Open `https://github.com/odarino/Backlog.md/actions` and enable workflows for the fork.
   - Create an npm granular access token with read and write rights for packages in the `@odarino` scope. It must allow publishing new packages.
   - Add the token as the repository secret `NPM_TOKEN` (Settings → Secrets and variables → Actions).
3. The controller pushes `main`, after asking the user, and waits for the CI run to pass on all 3 operating systems.
4. The controller asks the user, then creates and pushes the tag `v1.54.0`. Then it watches the release workflow until all of these finish:
   - build
   - publish-binaries
   - verify-platform-packages
   - npm-publish
   - install-sanity
   - github-release
   - sync-version
5. Smoke test after publishing: `npm view @odarino/backlog.md version` prints `1.54.0`. Then, in a temp directory, run `npx -y @odarino/backlog.md@1.54.0 --version`.
6. Optional (not needed for CI): lock the published platform packages. Run `bun update @odarino/backlog.md-linux-x64 @odarino/backlog.md-linux-arm64 @odarino/backlog.md-darwin-x64 @odarino/backlog.md-darwin-arm64 @odarino/backlog.md-windows-x64 @odarino/backlog.md-windows-arm64`. Then set the 6 ranges in `package.json` back to `"*"`. Then run `bun install` and `bun run update-nix`. Check that `bun install --frozen-lockfile` passes and that `git diff --exit-code -- bun.nix` is clean after a second `update-nix`.
7. A re-run of a failed release uses the workflow file at the tagged commit, so a fix to `release.yml` needs a new tag.

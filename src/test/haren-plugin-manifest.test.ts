import { describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..", "..");

describe("haren plugin package files", () => {
	it("has a valid manifest that matches the haren contract", async () => {
		const m = await Bun.file(join(root, "haren-plugin.json")).json();
		expect(m.name).toBe("backlog");
		expect(m.harenApi).toBe("1");
		expect(m.version).toBeUndefined();
		expect(Object.keys(m.hooks).sort()).toEqual(["after-plan", "on-task-status", "session-start"]);
		for (const cmd of Object.values(m.hooks)) expect(cmd).toMatch(/^backlog haren-hook /);
		expect(m.setup).toHaveLength(1);
		expect(m.setup[0]).toContain("--no-git");
		expect(m.setup[0]).toContain("git rev-parse");
		expect(m.setup[0]).toContain("{{project}}");
		for (const s of m.skills) expect(existsSync(join(root, s, "SKILL.md"))).toBe(true);
	});
	it("ships the plugin files in npm and release builds", async () => {
		const pkg = await Bun.file(join(root, "package.json")).json();
		expect(pkg.files).toEqual(expect.arrayContaining(["haren-plugin.json", "skills/"]));
		const release = await Bun.file(join(root, ".github/workflows/release.yml")).text();
		expect(release).toContain('"haren-plugin.json"');
		expect(release).toContain("--tag next");
		expect(release.split("$NPM_TAG").length - 1).toBeGreaterThanOrEqual(4);
	});
});

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
		for (const path of [
			"scripts/resolveBinary.cjs",
			"scripts/postuninstall.cjs",
			"scripts/cli.cjs",
			".github/workflows/release.yml",
		]) {
			const text = await read(path);
			// An unscoped platform package name is "backlog.md-<os>" not preceded by "@odarino/".
			expect(text.match(/(?<!@odarino\/)backlog\.md-(linux|darwin|windows)/g) ?? []).toEqual([]);
			expect(text).not.toContain("github.com/MrLesk/Backlog.md");
			expect(text).not.toMatch(/npm i(nstall)? -g backlog\.md\b/);
		}
	});
});

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
			// An unscoped package reference is "backlog.md-" or "backlog.md@" not preceded by "@odarino/".
			expect(text.match(/(?<!@odarino\/)\bbacklog\.md[-@]/g) ?? []).toEqual([]);
			expect(text).not.toContain("github.com/MrLesk/Backlog.md");
			expect(text).not.toMatch(/npm i(nstall)? -g backlog\.md\b/);
		}
	});

	describe("release workflow", () => {
		type Step = {
			name?: string;
			uses?: string;
			run?: string;
			env?: Record<string, string>;
			with?: Record<string, string>;
		};
		type Job = { strategy?: Record<string, unknown>; steps: Step[] };
		const loadJobs = async () => {
			const workflow = Bun.YAML.parse(await read(".github/workflows/release.yml")) as { jobs: Record<string, Job> };
			return workflow.jobs;
		};

		it("publishes with public access, provenance and the npm token", async () => {
			const jobs = await loadJobs();
			const publishSteps = Object.values(jobs)
				.flatMap((job) => job.steps)
				.filter((step) => step.run?.includes("npm publish"));
			expect(publishSteps.length).toBeGreaterThan(0);
			for (const step of publishSteps) {
				expect(step.run).toContain("--access public --provenance");
				// biome-ignore lint/suspicious/noTemplateCurlyInString: GitHub Actions expression, not a JS template
				expect(step.env?.NODE_AUTH_TOKEN).toBe("${{ secrets.NPM_TOKEN }}");
			}
		});

		it("points setup-node at the npm registry in the publish jobs", async () => {
			const jobs = await loadJobs();
			const setupSteps = ["npm-publish", "publish-binaries"]
				.flatMap((name) => jobs[name]?.steps ?? [])
				.filter((step) => step.uses?.startsWith("actions/setup-node"));
			expect(setupSteps.length).toBe(2);
			for (const step of setupSteps) expect(step.with?.["registry-url"]).toBe("https://registry.npmjs.org");
		});

		it("is safe to re-run", async () => {
			const jobs = await loadJobs();
			expect(jobs["publish-binaries"]?.strategy?.["fail-fast"]).toBe(false);
			const realPublishSteps = Object.values(jobs)
				.flatMap((job) => job.steps)
				.filter((step) => step.run?.includes("npm publish") && !step.run.includes("--dry-run"));
			expect(realPublishSteps.length).toBe(2);
			for (const step of realPublishSteps) expect(step.run).toContain("already published; skipping");
		});
	});
});

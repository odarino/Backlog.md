/**
 * Hidden `haren-hook` command - entry point for the haren plugin hooks.
 * The hook code loads lazily so normal commands never pay for it.
 */

import type { Command } from "commander";

export function registerHarenHookCommand(program: Command): void {
	program
		.command("haren-hook <hook>", { hidden: true })
		.description("Internal: haren plugin hook")
		.action(async (hook: string) => {
			try {
				const raw = (await Bun.stdin.text()).trim();
				let payload: Record<string, unknown>;
				try {
					payload = raw ? JSON.parse(raw) : {};
				} catch {
					console.error("Invalid hook payload");
					process.exitCode = 1;
					return;
				}
				const { runHarenHook } = await import("../haren/hooks.ts");
				const result = await runHarenHook(hook, payload, {
					root: process.env.HAREN_ROOT,
					dataDir: process.env.HAREN_PLUGIN_DATA,
					configJson: process.env.HAREN_PLUGIN_CONFIG,
				});
				process.stdout.write(`${JSON.stringify(result)}\n`);
			} catch (error) {
				console.error(error instanceof Error ? error.message : String(error));
				process.exitCode = 1;
			}
		});
}

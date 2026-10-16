import type { JsonSchema } from "../../validation/validators.ts";

export const assetAddSchema: JsonSchema = {
	type: "object",
	properties: {
		path: { type: "string", minLength: 1, maxLength: 1000 },
		taskId: { type: "string", minLength: 1, maxLength: 100 },
		original: { type: "boolean" },
	},
	required: ["path"],
	additionalProperties: false,
};

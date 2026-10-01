import { describe, expect, it } from "bun:test";
import {
	fileNameFromPath,
	formatBytes,
	imageFilesFrom,
	imageMarkdown,
	insertAtSelection,
	replaceFirst,
	uploadPlaceholder,
	uploadToastMessage,
} from "./markdown-image-insert";

describe("imageMarkdown", () => {
	it("uses the name without extension as alt text", () => {
		expect(imageMarkdown("my-shot.webp", "/assets/images/task-1/my-shot.webp")).toBe(
			"![my-shot](/assets/images/task-1/my-shot.webp)",
		);
	});

	it("strips characters that would break the alt text", () => {
		expect(imageMarkdown("a]b[c\\d.png", "/x.png")).toBe("![abcd](/x.png)");
	});
});

describe("insertAtSelection", () => {
	it("inserts at the cursor and replaces a selection", () => {
		expect(insertAtSelection("hello world", 5, 5, "!")).toEqual({ value: "hello! world", cursor: 6 });
		expect(insertAtSelection("hello world", 6, 11, "there")).toEqual({ value: "hello there", cursor: 11 });
	});

	it("clamps out-of-range positions", () => {
		expect(insertAtSelection("abc", 10, 20, "!")).toEqual({ value: "abc!", cursor: 4 });
		expect(insertAtSelection("abc", 2, 1, "!")).toEqual({ value: "ab!c", cursor: 3 });
	});
});

describe("placeholders", () => {
	it("creates unique placeholders for the same name", () => {
		const a = uploadPlaceholder("shot.png");
		const b = uploadPlaceholder("shot.png");
		expect(a).not.toBe(b);
		expect(a).toMatch(/^!\[Uploading shot\.png…\]\(uploading:[a-z0-9-]+\)$/);
	});

	it("replaces only the first occurrence and ignores missing text", () => {
		expect(replaceFirst("x P y P", "P", "Q")).toBe("x Q y P");
		expect(replaceFirst("abc", "zzz", "Q")).toBe("abc");
	});
});

describe("imageFilesFrom", () => {
	it("keeps image files only", () => {
		const png = new File(["x"], "a.png", { type: "image/png" });
		const txt = new File(["x"], "a.txt", { type: "text/plain" });
		expect(imageFilesFrom([png, txt])).toEqual([png]);
		expect(imageFilesFrom(null)).toEqual([]);
	});
});

describe("toast text", () => {
	it("formats sizes", () => {
		expect(formatBytes(512)).toBe("512 B");
		expect(formatBytes(180 * 1024)).toBe("180 KB");
		expect(formatBytes(3.2 * 1024 * 1024)).toBe("3.2 MB");
	});

	it("describes the upload result", () => {
		expect(
			uploadToastMessage({ path: "/x", originalSize: 3.2 * 1024 * 1024, finalSize: 180 * 1024, compressed: true }),
		).toBe("Compressed 3.2 MB → 180 KB");
		expect(uploadToastMessage({ path: "/x", originalSize: 10, finalSize: 10, compressed: false })).toBe(
			"Saved (not compressed)",
		);
	});

	it("reads the file name from a public path", () => {
		expect(fileNameFromPath("/assets/images/task-1/My%20Chart.svg")).toBe("My Chart.svg");
	});
});

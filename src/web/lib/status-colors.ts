const normalizeKey = (status: string): string => status.toLowerCase().replace(/\s+/g, "");

export function readableTextColor(hex: string): "#111827" | "#ffffff" {
	const channel = (start: number) => Number.parseInt(hex.slice(start, start + 2), 16) / 255;
	const luminance = 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
	return luminance > 0.5 ? "#111827" : "#ffffff";
}

export function statusColorFor(colors: Record<string, string> | undefined, status: string): string | null {
	if (!colors) return null;
	const key = normalizeKey(status);
	for (const [name, color] of Object.entries(colors)) {
		if (normalizeKey(name) === key) return color;
	}
	return null;
}

export function statusChipStyle(
	colors: Record<string, string> | undefined,
	status: string,
): { backgroundColor: string; color: string } | undefined {
	const color = statusColorFor(colors, status);
	return color ? { backgroundColor: color, color: readableTextColor(color) } : undefined;
}

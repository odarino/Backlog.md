const normalizeKey = (status: string): string => status.toLowerCase().replace(/\s+/g, "");

const DARK_TEXT = "#111827";

// WCAG relative luminance of a #rrggbb color.
const relativeLuminance = (hex: string): number => {
	const channel = (start: number) => {
		const c = Number.parseInt(hex.slice(start, start + 2), 16) / 255;
		return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
	};
	return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
};

const DARK_TEXT_LUMINANCE = relativeLuminance(DARK_TEXT);

export function readableTextColor(hex: string): "#111827" | "#ffffff" {
	if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return "#ffffff";
	const l = relativeLuminance(hex);
	// Pick the text color with the higher WCAG contrast ratio.
	const darkContrast = (l + 0.05) / (DARK_TEXT_LUMINANCE + 0.05);
	const whiteContrast = 1.05 / (l + 0.05);
	return darkContrast >= whiteContrast ? DARK_TEXT : "#ffffff";
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

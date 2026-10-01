const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function reject(status: number, error: string): Response {
	return Response.json({ error }, { status });
}

/**
 * Guard for the local web server.
 * Blocks DNS rebinding (unknown Host) and cross-site writes (foreign Origin).
 * Returns null to allow the request, or the rejection Response.
 */
export function checkRequest(req: Request, port: number | null): Response | null {
	// Fail closed: with no known port, nothing can match.
	if (port === null) {
		return reject(421, "Host not allowed");
	}
	const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
	if (port === 80) {
		// Browsers omit the default port in Host and Origin.
		allowedHosts.add("127.0.0.1");
		allowedHosts.add("localhost");
	}

	const host = req.headers.get("host")?.toLowerCase();
	if (!host || !allowedHosts.has(host)) {
		return reject(421, "Host not allowed");
	}

	const isUpgrade = req.headers.get("upgrade")?.toLowerCase() === "websocket";
	if (SAFE_METHODS.has(req.method.toUpperCase()) && !isUpgrade) {
		return null;
	}

	const origin = req.headers.get("origin");
	if (origin === null) {
		return null;
	}
	try {
		const url = new URL(origin);
		if (url.protocol === "http:" && allowedHosts.has(url.host.toLowerCase())) {
			return null;
		}
	} catch {
		// Invalid Origin falls through to rejection.
	}
	return reject(403, "Origin not allowed");
}

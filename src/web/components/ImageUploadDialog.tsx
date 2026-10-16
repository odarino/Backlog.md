import { useEffect, useState } from "react";
import type { AssetPreview, UploadMode } from "../../types";
import { apiClient } from "../lib/api";
import { formatBytes } from "../lib/markdown-image-insert";

export interface ImageUploadDialogProps {
	files: File[];
	onConfirm: (mode: UploadMode) => void;
	onCancel: () => void;
}

type PreviewState =
	| { status: "loading" }
	| { status: "ready"; preview: AssetPreview }
	| { status: "error"; message: string };

const CANNOT_CONVERT = "This image cannot be converted";

export default function ImageUploadDialog({ files, onConfirm, onCancel }: ImageUploadDialogProps) {
	const [previews, setPreviews] = useState<PreviewState[]>([]);
	const [mode, setMode] = useState<UploadMode>("convert");
	const [originalUrls, setOriginalUrls] = useState<string[]>([]);

	useEffect(() => {
		if (files.length === 0) {
			setPreviews([]);
			setOriginalUrls([]);
			return;
		}
		let cancelled = false;
		const urls = files.map((file) => URL.createObjectURL(file));
		setOriginalUrls(urls);
		setMode("convert");
		setPreviews(files.map(() => ({ status: "loading" })));
		files.forEach((file, index) => {
			apiClient
				.previewAsset(file)
				.then((preview): PreviewState => ({ status: "ready", preview }))
				.catch(
					(error): PreviewState => ({
						status: "error",
						message: error instanceof Error ? error.message : "Preview failed",
					}),
				)
				.then((state) => {
					if (cancelled) return;
					setPreviews((current) => current.map((item, i) => (i === index ? state : item)));
				});
		});
		return () => {
			cancelled = true;
			for (const url of urls) URL.revokeObjectURL(url);
		};
	}, [files]);

	const failureMessage = (() => {
		for (const item of previews) {
			if (item.status === "error") return item.message;
			if (item.status === "ready" && !item.preview.compressed) return CANNOT_CONVERT;
		}
		return null;
	})();
	const effectiveMode: UploadMode = failureMessage ? "original" : mode;

	if (files.length === 0) return null;
	const loading = previews.some((p) => p.status === "loading");

	const toggleClass = (active: boolean) =>
		`px-3 py-1 text-sm rounded-md border ${active ? "bg-blue-600 text-white border-blue-600" : "border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200"} disabled:opacity-50`;

	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
			role="dialog"
			aria-modal="true"
			aria-label="Upload images"
		>
			<div className="w-full max-w-2xl rounded-lg bg-white p-4 shadow-xl dark:bg-gray-800">
				<div className="mb-3 flex gap-2">
					<button
						type="button"
						className={toggleClass(effectiveMode === "convert")}
						aria-pressed={effectiveMode === "convert"}
						disabled={Boolean(failureMessage)}
						onClick={() => setMode("convert")}
					>
						Convert
					</button>
					<button
						type="button"
						className={toggleClass(effectiveMode === "original")}
						aria-pressed={effectiveMode === "original"}
						onClick={() => setMode("original")}
					>
						Original
					</button>
				</div>
				{failureMessage && <p className="mb-2 text-sm text-red-600 dark:text-red-400">{failureMessage}</p>}
				<ul className="max-h-[60vh] space-y-3 overflow-auto">
					{files.map((file, index) => {
						const state = previews[index];
						const ready = state?.status === "ready" ? state.preview : null;
						const src = effectiveMode === "convert" && ready ? ready.dataUrl : originalUrls[index];
						return (
							<li key={`${file.name}-${index}`} className="flex items-center gap-3">
								{src && (
									<img
										src={src}
										alt={file.name}
										className="h-24 w-32 rounded bg-gray-100 object-contain dark:bg-gray-900"
									/>
								)}
								<div className="text-sm text-gray-700 dark:text-gray-200">
									<div className="font-medium">{file.name || "pasted image"}</div>
									<div>
										{ready ? `${formatBytes(ready.originalSize)} → ${formatBytes(ready.finalSize)}` : formatBytes(file.size)}
									</div>
								</div>
							</li>
						);
					})}
				</ul>
				<div className="mt-4 flex justify-end gap-2">
					<button
						type="button"
						className="px-3 py-1 text-sm rounded-md border border-gray-300 dark:border-gray-600"
						onClick={onCancel}
					>
						Cancel
					</button>
					<button
						type="button"
						className="px-3 py-1 text-sm rounded-md bg-blue-600 text-white disabled:opacity-50"
						disabled={loading && effectiveMode === "convert"}
						onClick={() => onConfirm(effectiveMode)}
					>
						Insert
					</button>
				</div>
			</div>
		</div>
	);
}

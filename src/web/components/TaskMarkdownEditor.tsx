import MDEditor, { commands as mdCommands, type ICommand } from "@uiw/react-md-editor";
import { type ClipboardEvent, type DragEvent, useEffect, useMemo, useRef, useState } from "react";
import type { UploadMode } from "../../types";
import { apiClient } from "../lib/api";
import {
	fileNameFromPath,
	imageFilesFrom,
	imageMarkdown,
	insertAtSelection,
	replaceFirst,
	uploadPlaceholder,
	uploadToastMessage,
} from "../lib/markdown-image-insert";
import AssetPickerModal from "./AssetPickerModal";
import ImageUploadDialog from "./ImageUploadDialog";
import { SuccessToast } from "./SuccessToast";

interface Props {
	value: string;
	onChange: (value: string) => void;
	taskId?: string;
	height: number;
	colorMode: "light" | "dark";
	placeholder?: string;
	onOverlayChange?: (open: boolean) => void;
}

interface Toast {
	message: string;
	tone: "success" | "error";
}

interface PendingUpload {
	file: File;
	uploadName: string;
	label: string;
}

export default function TaskMarkdownEditor({ value, onChange, taskId, height, colorMode, placeholder, onOverlayChange }: Props) {
	// Uploads finish after later keystrokes, so edits always start from the latest value.
	const valueRef = useRef(value);
	valueRef.current = value;
	const onChangeRef = useRef(onChange);
	onChangeRef.current = onChange;
	const queueRef = useRef<Promise<void>>(Promise.resolve());
	const [toast, setToast] = useState<Toast | null>(null);
	const [pickerOpen, setPickerOpen] = useState(false);
	const [pending, setPending] = useState<{ uploads: PendingUpload[]; start: number; end: number } | null>(null);
	const pendingFiles = useMemo(() => pending?.uploads.map((upload) => upload.file) ?? [], [pending]);
	const selectionRef = useRef({ start: value.length, end: value.length });
	const onOverlayChangeRef = useRef(onOverlayChange);
	onOverlayChangeRef.current = onOverlayChange;
	const pickerOpenRef = useRef(false);
	const overlayOpen = pickerOpen || pending !== null;

	useEffect(() => {
		pickerOpenRef.current = overlayOpen;
		onOverlayChangeRef.current?.(overlayOpen);
	}, [overlayOpen]);

	// If the editor unmounts while the picker is open, the parent must not stay in "overlay open".
	useEffect(
		() => () => {
			if (pickerOpenRef.current) onOverlayChangeRef.current?.(false);
		},
		[],
	);

	useEffect(() => {
		if (!toast) return;
		const timer = window.setTimeout(() => setToast(null), 3000);
		return () => window.clearTimeout(timer);
	}, [toast]);

	const commit = (next: string) => {
		valueRef.current = next;
		onChangeRef.current(next);
	};

	const startUploads = (uploads: PendingUpload[], start: number, end: number, mode: UploadMode) => {
		const placeholders = uploads.map((upload) => uploadPlaceholder(upload.label));
		commit(insertAtSelection(valueRef.current, start, end, placeholders.join("\n")).value);
		uploads.forEach((upload, index) => {
			const marker = placeholders[index] as string;
			queueRef.current = queueRef.current.then(async () => {
				try {
					const saved = await apiClient.uploadAsset(upload.file, upload.uploadName, taskId, mode);
					commit(replaceFirst(valueRef.current, marker, imageMarkdown(fileNameFromPath(saved.path), saved.path)));
					setToast({ message: uploadToastMessage(saved), tone: "success" });
				} catch (error) {
					commit(replaceFirst(valueRef.current, marker, ""));
					setToast({ message: error instanceof Error ? error.message : "Upload failed", tone: "error" });
				}
			});
		});
	};

	const requestUploads = (uploads: PendingUpload[], textarea: HTMLTextAreaElement) => {
		setPending({ uploads, start: textarea.selectionStart, end: textarea.selectionEnd });
	};

	const handlePaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
		const files = imageFilesFrom(event.clipboardData);
		if (files.length === 0) return;
		event.preventDefault();
		requestUploads(
			files.map((file) => ({ file, uploadName: "", label: "pasted image" })),
			event.currentTarget,
		);
	};

	const handleDragOver = (event: DragEvent<HTMLTextAreaElement>) => {
		if (Array.from(event.dataTransfer?.types ?? []).includes("Files")) event.preventDefault();
	};

	const handleDrop = (event: DragEvent<HTMLTextAreaElement>) => {
		// A file drop that is not prevented makes the browser open the file and lose the edits.
		if (Array.from(event.dataTransfer?.types ?? []).includes("Files")) event.preventDefault();
		const files = imageFilesFrom(event.dataTransfer);
		if (files.length === 0) return;
		requestUploads(
			files.map((file) => ({ file, uploadName: file.name, label: file.name })),
			event.currentTarget,
		);
	};

	const pickerCommand: ICommand = {
		name: "asset-picker",
		keyCommand: "asset-picker",
		buttonProps: { "aria-label": "Insert image from assets", title: "Insert image from assets" },
		icon: (
			<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
				<rect x="3" y="3" width="18" height="18" rx="2" />
				<circle cx="8.5" cy="8.5" r="1.5" />
				<path d="M21 15l-5-5L5 21" />
			</svg>
		),
		execute: (state) => {
			selectionRef.current = { start: state.selection.start, end: state.selection.end };
			setPickerOpen(true);
		},
	};

	return (
		<>
			<MDEditor
				value={value}
				onChange={(next) => commit(next || "")}
				preview="edit"
				commands={[...mdCommands.getCommands(), mdCommands.divider, pickerCommand]}
				height={height}
				data-color-mode={colorMode}
				textareaProps={{
					...(placeholder ? { placeholder } : {}),
					onPaste: handlePaste,
					onDragOver: handleDragOver,
					onDrop: handleDrop,
				}}
			/>
			{toast && <SuccessToast message={toast.message} tone={toast.tone} onDismiss={() => setToast(null)} />}
			<AssetPickerModal
				isOpen={pickerOpen}
				taskId={taskId}
				onClose={() => setPickerOpen(false)}
				onInsert={(markdown) => {
					const { start, end } = selectionRef.current;
					commit(insertAtSelection(valueRef.current, start, end, markdown).value);
				}}
				onUploaded={(saved) => setToast({ message: uploadToastMessage(saved), tone: "success" })}
			/>
			<ImageUploadDialog
				files={pendingFiles}
				onCancel={() => setPending(null)}
				onConfirm={(mode) => {
					if (pending) startUploads(pending.uploads, pending.start, pending.end, mode);
					setPending(null);
				}}
			/>
		</>
	);
}

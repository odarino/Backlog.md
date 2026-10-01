import type { Task, TaskCreateInput } from "../types/index.ts";

/** Field rules for cloning a task; see docs/superpowers/specs/2026-10-01-task-clone-design.md. */
export function buildTaskCloneInput(task: Task, options: { title?: string } = {}): TaskCreateInput {
	const isDraft = (task.status ?? "").trim().toLowerCase() === "draft";
	return {
		title: options.title ?? `Copy of ${task.title}`,
		...(isDraft ? { status: "Draft" } : {}),
		description: task.description,
		implementationPlan: task.implementationPlan,
		labels: [...(task.labels ?? [])],
		priority: task.priority,
		type: task.type,
		project: task.project,
		milestone: task.milestone,
		assignee: [...(task.assignee ?? [])],
		dependencies: [...(task.dependencies ?? [])],
		parentTaskId: task.parentTaskId,
		references: task.references ? [...task.references] : undefined,
		documentation: task.documentation ? [...task.documentation] : undefined,
		modifiedFiles: task.modifiedFiles ? [...task.modifiedFiles] : undefined,
		acceptanceCriteria: (task.acceptanceCriteriaItems ?? []).map((item) => ({ text: item.text, checked: false })),
		definitionOfDoneAdd: (task.definitionOfDoneItems ?? []).map((item) => item.text),
		disableDefinitionOfDoneDefaults: true,
	};
}

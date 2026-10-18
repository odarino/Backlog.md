---
name: haren-board
description: Use the Backlog.md board inside a haren project. Open the board, read task status, and change status through haren.
---

# Backlog board for haren

haren syncs its planned features with Backlog.md tasks. Each synced task has the label `haren:<module>/<feature>`.

## Open the board

- Terminal board: `backlog board`
- Web board: `backlog browser`

## Rules

1. In a haren session, change a feature status with the haren `update-tracking` skill. Do not change it with `backlog task edit`. haren then updates the board.
2. A person can move a task on the board. haren reads the change at the next session start.
3. haren owns the title, the description, and the dependencies of a synced task. Change them in the haren plan, not on the board.
4. Do not remove the `haren:` label from a task. haren uses it to find the task.

---
name: haren-board
description: Use the Backlog.md board inside a haren project. Open the board, read task status, and change status through haren.
---

# Backlog board for haren

haren syncs its planned features with Backlog.md tasks. Each synced task has the label `haren:<module>/<feature>`.

## Find the board

The board is always in `<haren folder>/backlog/`. The place of the config file depends on the haren layout.

| Layout | Config file | Where to run `backlog` |
|---|---|---|
| monorepo | `backlog.config.yml` in the project root | Anywhere in the project |
| workspace | `<haren folder>/backlog/config.yml` | Inside the haren folder |

In the workspace layout, the haren folder is its own git repo. The config file is in that repo, so your team gets it when they clone the repo.

## Open the board

1. Go to the correct folder for your layout.
2. Run `backlog board` for the terminal board.
3. Run `backlog browser` for the web board.

## Rules

1. In a haren session, change a feature status with the haren `update-tracking` skill. Do not change it with `backlog task edit`. haren then updates the board.
2. A person can move a task on the board. haren reads the change at the next session start.
3. haren owns the title, the description, and the dependencies of a synced task. Change them in the haren plan, not on the board.
4. Do not remove the `haren:` label from a task. haren uses it to find the task.

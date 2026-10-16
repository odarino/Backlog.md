---
id: BACK-713
title: Optional random numeric task IDs
status: In Progress
assignee:
  - '@claude'
created_date: '2026-10-16 13:54'
updated_date: '2026-10-16 14:12'
labels:
  - core
  - config
dependencies: []
documentation:
  - docs/superpowers/specs/2026-10-16-random-task-ids-design.md
ordinal: 343000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Sequential IDs collide when several people or branches create tasks at the same time. An opt-in random numeric ID mode makes collisions very unlikely while keeping IDs numeric.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 taskIdMode config accepts sequential or random; default sequential
- [ ] #2 In random mode new tasks get a 6-digit ID not used on any known branch
- [ ] #3 Generation retries on collision and fails with a clear error after the retry limit
- [ ] #4 Subtasks of a random-ID parent stay sequential (.1, .2)
- [ ] #5 Drafts, documents, decisions, and existing tasks are unchanged
- [ ] #6 Config help and agent instructions document taskIdMode
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 bunx tsc --noEmit passes when TypeScript touched
- [ ] #2 bun run check . passes when formatting/linting touched
- [ ] #3 bun test (or scoped test) passes
<!-- DOD:END -->

---
id: BACK-713
title: Optional random numeric task IDs
status: Done
assignee:
  - '@claude'
created_date: '2026-10-16 13:54'
updated_date: '2026-10-16 14:35'
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
- [x] #1 taskIdMode config accepts sequential or random; default sequential
- [x] #2 In random mode new tasks get a 6-digit ID not used on any known branch
- [x] #3 Generation retries on collision and fails with a clear error after the retry limit
- [x] #4 Subtasks of a random-ID parent stay sequential (.1, .2)
- [x] #5 Drafts, documents, decisions, and existing tasks are unchanged
- [x] #6 Config help and agent instructions document taskIdMode
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 bunx tsc --noEmit passes when TypeScript touched
- [x] #2 bun run check . passes when formatting/linting touched
- [x] #3 bun test (or scoped test) passes
<!-- DOD:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added config taskIdMode (sequential default | random 6-digit task IDs, retries on collision, subtasks stay .1), CLI config and Settings select, docs. tsc, biome, tests pass.
<!-- SECTION:FINAL_SUMMARY:END -->

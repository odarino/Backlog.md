---
id: BACK-711
title: Fix image paste into task rich-text fields on Windows
status: In Progress
assignee:
  - '@claude'
created_date: '2026-10-16 13:54'
updated_date: '2026-10-16 14:00'
labels:
  - web
  - bug
dependencies: []
documentation:
  - docs/superpowers/specs/2026-10-16-image-paste-and-upload-mode-design.md
ordinal: 341000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Pasting a screenshot (Snipping Tool) or an image file copied from Explorer into the Description field of the create form does nothing. `imageFilesFrom` reads only `clipboardData.files` and drops files with an empty MIME type, so Windows clipboard images are silently ignored.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Pasting a Snipping Tool screenshot into Description on create and edit inserts the image
- [ ] #2 Pasting an image file copied from Explorer with an empty MIME type inserts the image
- [ ] #3 Images exposed only via clipboard items are picked up; duplicates are inserted once
- [ ] #4 Unit tests cover empty type, items-only, and duplicate cases
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 bunx tsc --noEmit passes when TypeScript touched
- [ ] #2 bun run check . passes when formatting/linting touched
- [ ] #3 bun test (or scoped test) passes
<!-- DOD:END -->

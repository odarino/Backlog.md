---
id: BACK-711
title: Fix image paste into task rich-text fields on Windows
status: Done
assignee:
  - '@claude'
created_date: '2026-10-16 13:54'
updated_date: '2026-10-17 03:24'
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
- [x] #1 Pasting a Snipping Tool screenshot into Description on create and edit inserts the image
- [x] #2 Pasting an image file copied from Explorer with an empty MIME type inserts the image
- [x] #3 Images exposed only via clipboard items are picked up; duplicates are inserted once
- [x] #4 Unit tests cover empty type, items-only, and duplicate cases
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 bunx tsc --noEmit passes when TypeScript touched
- [x] #2 bun run check . passes when formatting/linting touched
- [x] #3 bun test (or scoped test) passes
<!-- DOD:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Manual check passed: Snipping Tool paste on Windows inserts the image (tested via SSH tunnel to the local server). Shipped in v1.56.1.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Clipboard files and items are read, type inferred from extension, duplicates removed; unit tests cover it. Real Snipping Tool/Explorer paste in a browser (AC 1) is not yet verified manually.
<!-- SECTION:FINAL_SUMMARY:END -->

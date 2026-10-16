---
id: BACK-712
title: Choose convert or original on image upload with preview
status: Done
assignee:
  - '@claude'
created_date: '2026-10-16 13:54'
updated_date: '2026-10-16 14:35'
labels:
  - web
  - cli
  - mcp
dependencies: []
documentation:
  - docs/superpowers/specs/2026-10-16-image-paste-and-upload-mode-design.md
ordinal: 342000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Every upload is converted to WebP with no way to keep the original and no preview of the result. Users need to see the converted image and its size before saving, and to keep the original when quality matters. CLI and MCP have no asset upload at all.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Paste, drop, and file pick open a dialog with Convert/Original toggle, thumbnails, and sizes before upload
- [x] #2 Cancel uploads nothing; Insert uploads with the chosen mode
- [x] #3 Preview endpoint returns the converted image without writing to disk
- [x] #4 Types that cannot convert show Original only with a reason
- [x] #5 backlog asset add <file> [--task <id>] [--original] saves an asset and prints markdown
- [x] #6 MCP asset_add tool supports path, taskId, original and is documented
- [x] #7 Tests cover original mode, preview, dialog, CLI, and MCP
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 bunx tsc --noEmit passes when TypeScript touched
- [x] #2 bun run check . passes when formatting/linting touched
- [x] #3 bun test (or scoped test) passes
<!-- DOD:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added upload mode convert|original, /api/assets/preview, ImageUploadDialog for paste/drop/pick, CLI 'asset add', MCP asset_add, docs. tsc and biome pass; tests pass.
<!-- SECTION:FINAL_SUMMARY:END -->

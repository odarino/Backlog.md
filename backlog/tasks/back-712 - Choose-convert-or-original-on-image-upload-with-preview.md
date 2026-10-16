---
id: BACK-712
title: Choose convert or original on image upload with preview
status: To Do
assignee: []
created_date: '2026-10-16 13:54'
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
- [ ] #1 Paste, drop, and file pick open a dialog with Convert/Original toggle, thumbnails, and sizes before upload
- [ ] #2 Cancel uploads nothing; Insert uploads with the chosen mode
- [ ] #3 Preview endpoint returns the converted image without writing to disk
- [ ] #4 Types that cannot convert show Original only with a reason
- [ ] #5 backlog asset add <file> [--task <id>] [--original] saves an asset and prints markdown
- [ ] #6 MCP asset_add tool supports path, taskId, original and is documented
- [ ] #7 Tests cover original mode, preview, dialog, CLI, and MCP
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 bunx tsc --noEmit passes when TypeScript touched
- [ ] #2 bun run check . passes when formatting/linting touched
- [ ] #3 bun test (or scoped test) passes
<!-- DOD:END -->

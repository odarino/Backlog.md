# Random numeric task IDs

## Goal

Lower the chance of duplicate task IDs when several people or branches create tasks at the same time. IDs stay numeric (`BACK-482913`).

## Design

### Config

New key `taskIdMode: sequential | random` in `backlog/config.yml`. Default `sequential`, so existing repos keep their behavior. Settable with `backlog config set taskIdMode random` and in the web settings page.

### Generation

- One change point: `generateNextPrefixedId` (`src/utils/prefix-config.ts`, called from `Core.generateNextId`).
- In `random` mode: pick a random integer in `100000–999999` (6 digits) with `crypto.getRandomValues`.
- Retry when the ID exists in the set of known IDs (`getExistingIdsForType`, which already covers active, completed, and cross-branch tasks). Fail with a clear error after 50 tries.
- `zeroPaddedIds` is ignored in `random` mode (6 digits already fixed).
- Subtasks stay sequential under the parent: `BACK-482913.1`, `.2`.
- Applies to tasks only. Drafts, documents, decisions keep current behavior.
- Existing tasks keep their IDs. No migration.

### Effects to accept

- Sort by ID no longer means creation order. Board and list ordering already use ordinal / dates; any view that sorts by ID numerically keeps working but is no longer chronological.
- Collision risk is not zero across unsynced branches (~1 in 900,000 per pair). The existing duplicate-ID repair (BACK-708) still covers this.

### Public surface

- Document `taskIdMode` in config help and shipped agent instructions.
- `backlog task create` output is unchanged except for the ID shape.

## Testing

- Unit: `random` mode returns a 6-digit ID not in the existing set; retries on collision (stub the random source); errors after the retry limit.
- Unit: `sequential` mode unchanged.
- Subtask under a random parent gets `.1`.
- Config: `taskIdMode` set/get validates the two values.

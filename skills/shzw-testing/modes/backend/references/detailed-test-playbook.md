# Detailed backend test playbook

Use this reference when a change needs multiple test layers.

## Layer selection

| Layer | Proves | Typical assertions |
|---|---|---|
| Unit | Pure logic, guards, mappings, state transitions | value, exception, DTO, rendered plan |
| Integration | Module/DI, repository-adapter, AppService composition | injected behavior, persisted state, rollback |
| Contract | Endpoint and serialization contract | status, stable error, headers, payload shape |
| Real DB | Provider SQL, schema/seed, concurrency, real predicates | rows, side effects, transaction/provider behavior |
| Real host/smoke | Startup, config, middleware, full API/CLI path | health, end-to-end response, observable workflow |

Use the lowest layer that proves the behavior. Add a higher layer only for risk the lower layer cannot observe.

## Coverage prompts

- Normal path plus the relevant reject, missing-context, invalid-input, or concurrency path.
- Derive expected results from the retained requirement or contract; do not reuse the production decision function to compute its own oracle.
- Pair a legal write and its committed readback with a denied write and before/after readback proving no forbidden mutation or audit payload. A reject-all implementation must fail the legal case. Select this pair when the changed risk includes allow/deny behavior, not for every pure calculation.
- Contract tests assert stable status/error/header/body, not snapshots of incidental formatting.
- Real tests use the real auth/tenant context and migration/seed order.
- Regression tests name the escaped behavior and remain deterministic.

For an authorized repair, run the same regression assertion against the old and repaired behavior when practical. If the old subject cannot be run, record that limit; do not weaken the assertion or alter a shared environment just to obtain a failing baseline.

## Real dependency lifecycle

Use an isolated name such as `test_<project>_<date>_<time>_<random>` and respect provider length limits. Before create or drop, confirm the name belongs to this run.

1. Inject connection sources through environment variables or ignored local config.
2. Create the isolated database/schema and apply migration/seed explicitly.
3. Start the runner or host and execute assertions.
4. On success, clean only workflow-owned temporary state.
5. On failure, record the database/report name and minimal reproduction before any cleanup.

Never print passwords or tokens. A retention limit may be applied only when a current runbook defines ownership and deletion rules; otherwise leave cleanup explicit and conservative.

## Failure handling

Keep the narrowest failing command and assertion. Decide whether the owner is production code, test code, seed/configuration, or documentation. Rerun after the fix. If unfinished, add or update one actionable task row.

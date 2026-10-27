---
name: shzw-backend-realdb-api-testing
description: Use when a user-defined Development task or explicitly requested SystemTest task needs assertion-backed backend API evidence against an isolated real database rather than mocks. Trigger for provider/schema/transaction behavior, response plus side-effect checks, or escaped production bugs; never infer the task type, a broad campaign, or deployment from use of a real database.
metadata:
  maintainer: 苏州苏宏助为智能科技有限公司
  source: https://github.com/xingshukeji/skills-hub/blob/main/skills/shzw-backend-realdb-api-testing/SKILL.md
---

# Backend Real DB API Testing

Resolve project entrypoints, source, documents and command working directories from the user's target project. Resolve this skill's `references/`, `scripts/` and `assets/` from its installed directory. Locate other responsible repositories through the target project's entrypoint; never infer the target from the skill installation path.

## Goal

Run the real host against an isolated database, assert HTTP behavior and persisted side effects, and retain enough safe evidence to reproduce failures.

This skill provides real-environment evidence for an already-defined outcome. It does not redefine product direction, scope, or the implementation completion rule unless the evidence proves the requested direction impossible or exposes a material unresolved choice.

Confirm the task's execution type from the user's primary requested result before running. In Development, use this skill for isolated, risk-focused real-database assertions that directly prove the current change. A real database, integration boundary, shared service, or broad suite does not itself create SystemTest; use [$shzw-system-testing](https://github.com/xingshukeji/skills-hub/blob/main/skills/shzw-system-testing/SKILL.md) only when the user explicitly requests an independent test result, then let that skill choose control strength and persistence independently.

## Load

Read root entries, target project `AGENTS.md`, current API/security/data contracts, the existing runner, and its current runbook. For XRain, use `文档/项目/项目_XRain/运行/RUN-0003-真实库API测试报告生成.md` and `XRain/backend/tools/XRain.ApiReportRunner`.

Use `shzw-aiinfra-adoption` too when package ownership or consumption is part of the change.

## Workflow

1. Add or run package-level tests for shared query, permission, ABAC, audit, runtime, and provider behavior before app scenarios.
2. Obtain the management connection from an environment variable or ignored local config; never commit or print it.
3. Create a uniquely named database, apply foundation then product migration/seed, start the real host, and record the database name.
4. Cover the relevant allow, deny, invalid-input, missing-context, tenant, concurrency, and audit paths. Stop expanding when the changed risk is proven.
5. Assert status, stable error/header/body shape, data visibility, and database side effects. A denied write must prove no forbidden mutation.
6. Fail the runner on any assertion. Drop the database only after success; on failure record the retained name and minimum reproduction.
7. Generate the report format and location defined by the current runner/runbook. Include scenario, expected/actual, assertions, sanitized curl/request, response, database lifecycle, and PASS/FAIL.

## Gates

- A response recorder without assertions is not a test.
- Mocked repositories or in-memory fallback cannot support a real-database claim.
- Reports contain no passwords, tokens, API keys, or unmasked secrets.
- Test-only fixture writes stay inside the isolated runner and do not become production patterns.
- Cleanup touches only artifacts proven to belong to this workflow.

## Verify and close

Run only the checks required by the user-defined task and selected risk; do not widen to every available suite without an explicitly requested SystemTest task. Run `git diff --check` for repository changes. Report assertion failures separately from environment, credential, startup, migration, or fixture failures. An assertion failure against the defined behavior is a product or implementation defect; an environment/setup failure means real-database evidence is unavailable and does not by itself rewrite an earlier Development result. Report this task's execution type, database lifecycle, report path, exact commands/results, skipped checks, residual risk, repository state, and remaining task IDs; mention another task type only when actually established.

---
name: shzw-backend-detailed-testing
description: Use for backend test evidence within a user-defined Development task, or as a scoped layer of an explicitly requested SystemTest task. Trigger for unit, integration, contract, isolated real-database, minimal real-host, smoke, missing coverage, or escaped regressions; choose the task type from the user's goal, never from the test technique or suite size.
metadata:
  maintainer: 苏州苏宏助为智能科技有限公司
  source: https://github.com/xingshukeji/skills-hub/blob/main/skills/shzw-backend-detailed-testing/SKILL.md
---

# Backend Detailed Testing

Resolve project entrypoints, source, documents and command working directories from the user's target project. Resolve this skill's `references/`, `scripts/` and `assets/` from its installed directory. Locate other responsible repositories through the target project's entrypoint; never infer the target from the skill installation path.

## Goal

In Development, prove the changed behavior with the cheapest high-signal layer, escalating to an isolated real dependency only when wiring, persistence, auth, provider, or runtime risk cannot be observed more narrowly.

This skill supplies evidence; it does not set product direction or invent acceptance criteria. Start from the retained outcome, boundary, invariants, completion rule, and risk. Return to direction alignment only when evidence proves the requested direction impossible or exposes a material unresolved choice.

Confirm the task's execution type from the user's goal before selecting tests. Feature development and Bug fixing are Development, and their unit, integration, contract, browser, real-database, or other range-matched evidence remains Development. Use [$shzw-system-testing](https://github.com/xingshukeji/skills-hub/blob/main/skills/shzw-system-testing/SKILL.md) only when the user explicitly makes an independent integration, system, full-suite, candidate, release-gate, or broad regression campaign the task goal.

## Load

Read root entries, the matched project `AGENTS.md`, the changed contract/code, existing tests/runners/fixtures, and the matched runbook. Read `references/detailed-test-playbook.md` when more than one test layer is needed. Also use `shzw-backend-realdb-api-testing` for assertion-backed real-database API verification.

## Workflow

1. Restate the already-defined changed behavior, affected public/data/security boundary, regression risk, and observable assertion without broadening acceptance.
2. Inventory existing test entrypoints with `rg`; extend the existing style instead of creating a parallel harness.
3. Select layers: unit for pure logic, integration for composition/persistence abstractions, contract for HTTP shape, and isolated real DB or minimal real host only when it is the smallest direct evidence for the changed risk.
4. Run the narrowest tests first. Fix failures and rerun the exact failing command before widening.
5. Use isolated, workflow-owned dependencies for real tests. Record variable names rather than secrets and preserve the failed database/report name before cleanup.
6. Run the final scoped suite plus the smallest enumerable consumer guard. Stop before a system-wide campaign and record it as a separate SystemTest candidate when actually requested.

## Safety

- Do not claim a real test when the dependency is mocked or side effects are not asserted.
- Do not weaken assertions to make a suite pass.
- Do not delete databases, reports, or logs without proving the current workflow owns them.
- Do not require a permanent report for a narrow unit-only pass; retain a report or reproducible failure evidence when multiple scenarios or real dependencies justify it.
- Put only authorized repair work needing durable recovery in `文档/TASK_CONTROL.md`; record an evidence-backed uncommitted repair outcome in `文档/WORK_CANDIDATES.md` without assigning an execution type.

## Closeout

Report this task's execution type, scope, exact commands, results, changed tests/runners, retained evidence, skipped coverage with reason, residual risk, and remaining task IDs. Do not list SystemTest or Deployment unless the user requested or the workflow actually established those separate tasks. An unavailable optional environment does not by itself make Development incomplete. A failing assertion against the defined behavior is a direct defect and does block completion. Run `git diff --check` for repository changes.

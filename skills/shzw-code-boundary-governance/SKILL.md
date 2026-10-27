---
name: shzw-code-boundary-governance
description: Use when reviewing or changing backend Repository, Manager, AppService, Controller, Endpoint, DI, Application.Contracts, data-access, or provider boundaries. Trigger for architecture reviews, refactors, dependency-injection issues, AiInfra-versus-app ownership, XRain runtime/metadata paths, or suspected duplicated shared infrastructure.
metadata:
  maintainer: 苏州苏宏助为智能科技有限公司
  source: https://github.com/xingshukeji/skills-hub/blob/main/skills/shzw-code-boundary-governance/SKILL.md
---

# Code Boundary Governance

Resolve project entrypoints, source, documents and command working directories from the user's target project. Resolve this skill's `references/`, `scripts/` and `assets/` from its installed directory. Locate other responsible repositories through the target project's entrypoint; never infer the target from the skill installation path.

## Goal

Place each behavior at the lowest correct owner without leaking HTTP, product orchestration, persistence, provider, or shared-infrastructure concerns across layers.

When `shzw-align-solution-direction` was required, consume its direction contract without reopening the outcome, boundary, invariants, ownership, or completion rule. Treat architecture choices that do not alter that contract as implementation decisions, non-goals, or follow-up work rather than a reason to redefine the requested result.

Use this skill in Development. Boundary repair and its scoped white-box evidence must not automatically trigger a SystemTest campaign or Deployment.

## Load

1. Read root entries, the matched project `AGENTS.md`, the current task row, and the touched code/tests.
2. Read `references/layer-boundary-checklist.md` for general review.
3. For AiInfra/XRain ownership, also use `shzw-aiinfra-adoption` and read `references/aiinfra-xrain-boundaries.md`.

Stop scanning when the public surface, one request path, DI registrations, tests, and current owner are clear.

## Workflow

1. Identify the public surface and trace only the affected path through the layers it actually reaches. Do not enumerate empty layers merely to complete a standard architecture checklist.
2. Classify each dependency as `allowed`, `thin adapter`, `boundary leak`, `responsibility drift`, or `infrastructure duplication`.
3. Move only the misplaced behavior: protocol to HTTP, product use case to AppService, reusable domain operation to manager/domain service, persistence mapping to repository/adapter, provider mechanics to provider infrastructure, and cross-cutting infrastructure to AiInfra.
4. Identify consumers before changing a public contract, permission, schema, provider contract, or shared package.
5. Add the smallest architecture, contract, integration, or real-database guard that proves the repaired boundary.

## Hard gates

- `Application.Contracts` contains public DTOs and AppService contracts, not repositories, stores, DbContexts, dialects, or internal query plans.
- HTTP code does not perform business orchestration or inject provider connections/persistence for ordinary workflows.
- AppServices do not emit SQL or own provider/query/security algorithms.
- Required security, runtime, and persistence dependencies fail fast.
- Provider-neutral contracts do not expose SQL fragments, quoted identifiers, connection types, or provider syntax.
- Product-specific context stays in structured filters, facts, grants, predicates, or thin adapters.

## Verify and close

Run scoped static scans plus affected Development build/tests and only the smallest isolated real-database check required by the risk, then `git diff --check`. Test technique and breadth do not change the task type; route an independent broad candidate campaign to SystemTest only when the user explicitly requests it. Report the affected path, classifications, files changed, Development evidence, repository state, and only genuinely unfinished task IDs. Mention SystemTest or Deployment only when actually requested or established. Git state does not reverse an already satisfied Development verdict; a direct defect does.

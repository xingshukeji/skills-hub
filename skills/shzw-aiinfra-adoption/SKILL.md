---
name: shzw-aiinfra-adoption
description: Use when an existing XRain or other .NET app should consume LLM_backend_packages / AiInfra.Abp.* instead of rebuilding shared infrastructure. Trigger for overlap audits or migrations involving DI, UoW, data access, query/runtime records, permissions, RBAC/ABAC, audit, object projection, providers, package feeds, Storage, RAG, or ChatHub.
metadata:
  maintainer: 苏州苏宏助为智能科技有限公司
  source: https://github.com/xingshukeji/skills-hub/blob/main/skills/shzw-aiinfra-adoption/SKILL.md
---

# AiInfra Adoption

Resolve project entrypoints, source, documents and command working directories from the user's target project. Resolve this skill's `references/`, `scripts/` and `assets/` from its installed directory. Locate other responsible repositories through the target project's entrypoint; never infer the target from the skill installation path.

## Goal

Choose one grounded outcome for each need: reuse AiInfra directly, keep a thin product adapter, enhance AiInfra, migrate app code, or correct the app contract. Track only authorized work needing recovery in `文档/TASK_CONTROL.md`; evidence-backed uncommitted outcomes belong in `文档/WORK_CANDIDATES.md` only when later-work discovery needs them.

## Load

1. Read root `AGENTS.md`, `文档/TASK_CONTROL.md`, the package project `AGENTS.md`, and the target project `AGENTS.md`.
2. Read the package boundary source `文档/项目/项目_LLM_backend_packages/技术设计/DOC-0002-AiInfra基础职责边界与下游禁建清单.md`.
3. Before adding app-local infrastructure, read `references/capability-map.md`.
4. For runtime query or object metadata, read `references/runtime-query-and-object-metadata.md`.
5. Before changing a public contract, security model, schema, provider, or package, read `references/security-package-validation.md`.

Stop loading once the touched source, current contract, tests, and consumer are clear.

## Workflow

1. Identify the consumer, touched public surface, current package API, and affected task row.
2. Inspect current AiInfra source, providers, tests, and package README before declaring a gap.
3. Inspect only the corresponding app path for duplicate DI, connections, transactions, SQL/query compilers, IDs, permissions, ABAC, audit tables, metadata, runtime storage, or provider wrappers.
4. Classify each finding as `reuse`, `thin adapter`, `upstream enhancement`, `app migration`, or `contract correction`.
5. Put cross-cutting behavior upstream. Keep workspace, release, environment, and other product dimensions as filters, facts, predicates, grants, or adapter inputs.
6. Validate the package and every affected consumer through package references and a temporary feed when public package behavior changes.

## Boundaries

- Do not add product-specific fields, generic scope bags, raw SQL fragments, or provider primitives to provider-neutral contracts.
- Do not replace consumer package references with cross-directory project references.
- Identify downstream consumers before changing public APIs, DTOs, schemas, permissions, or package versions.
- Fail security-sensitive paths closed; never hide a required dependency behind optional DI.
- Use ignored local configuration or environment variables for credentials.

## Verify and close

For a Development task, run the narrowest package tests, consumer build/tests, and isolated real-database evidence required by the changed risk, then run `git diff --check`. Test technique or breadth does not itself change the task type. Route to [$shzw-system-testing](https://github.com/xingshukeji/skills-hub/blob/main/skills/shzw-system-testing/SKILL.md) only when the user explicitly requests an independent full-candidate, cross-consumer, release-gate, integration, system, or full-suite campaign. Formal package publication or downstream rollout requires an explicitly requested Deployment task using [$shzw-release-deployment](https://github.com/xingshukeji/skills-hub/blob/main/skills/shzw-release-deployment/SKILL.md). Report this task's execution type, classifications, changed owners, package-consumer evidence, repository state, and remaining task IDs; mention other task types only when actually established.

# Code Boundary Governance

本模式的参考、脚本和资源位于加载结果的 resourceBase.path + "/modes/boundaries"。命令工作目录与项目事实由当前责任项目入口确定；相对资源链接按本模式目录解析。

## Goal

Place each behavior at the lowest correct owner without leaking HTTP, product orchestration, persistence, provider, or shared-infrastructure concerns across layers.

When `shzw-solution` was required, consume its direction contract without reopening the outcome, boundary, invariants, ownership, or completion rule. Treat architecture choices that do not alter that contract as implementation decisions, non-goals, or follow-up work rather than a reason to redefine the requested result.

实施边界修复及其定向验证属于 Development；只读架构审查保持当前只读范围。读取这里的分层知识不自动启动实现、SystemTest 或 Deployment。

## Load

1. Read root entries, the matched project `AGENTS.md`, the current task row, and the touched code/tests.
2. Read `references/layer-boundary-checklist.md` for general review.
3. For AiInfra/XRain ownership, use the relevant [reuse topic](../reuse/GUIDE.md) and read `references/aiinfra-xrain-boundaries.md`.

Stop scanning when the affected public surface, actual entries and special branches, DI registrations, tests and current owner are clear; do not stop at the first ordinary request path.

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

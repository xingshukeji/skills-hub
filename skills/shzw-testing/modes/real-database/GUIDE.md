# Backend Real DB API Testing

本模式的参考、脚本和资源位于加载结果的 resourceBase.path + "/modes/real-database"。命令工作目录与项目事实由当前责任项目入口确定；相对资源链接按本模式目录解析。

## Goal

Run the real host against an isolated database, assert HTTP behavior and persisted side effects, and retain enough safe evidence to reproduce failures.

This skill provides real-environment evidence for an already-defined outcome. It does not redefine product direction, scope, or the implementation completion rule unless the evidence proves the requested direction impossible or exposes a material unresolved choice.

Confirm the task's execution type from the user's primary requested result before running. In Development, use this skill for isolated, risk-focused real-database assertions that directly prove the current change. A real database, integration boundary, shared service, or broad suite does not itself create SystemTest; use [本入口的 system 方法](../system/GUIDE.md) only when the user explicitly requests an independent test result, then let that skill choose control strength and persistence independently.

## Load

Read root entries, target project AGENTS, current API/security/data contracts, the existing runner, and its current Runbook. In XRain platform maintenance, locate the XRain-owned Runbook《真实库 API 测试报告生成》and its XRain.ApiReportRunner through that project's entry. Other projects use their own runner and supported API; this method does not require a private XRain checkout merely to verify a consumer.

Use `shzw-aiinfra-development` too when package ownership or consumption is part of the change.

## Workflow

以下建库流程用于确实拥有宿主、迁移与数据库入口的平台维护。只验证公共业务消费者时，复用目标获准环境和 API 核对可见持久结果；不要求取得管理连接或新建平台数据库，也不把 API 证据称为已证明内部事务/provider 语义。需要后者时由责任项目的隔离测试补证。

1. 只在公共包行为受影响时运行对应查询、权限、ABAC、审计、runtime 或 provider 测试；消费既有 API 的业务场景不先跑全部基础包测试。
2. Obtain the management connection from an environment variable or ignored local config; never commit or print it.
3. Create a uniquely named database, apply foundation then product migration/seed, start the real host, and record the database name.
4. Cover the relevant allow, deny, invalid-input, missing-context, tenant, concurrency, and audit paths. Stop expanding when the changed risk is proven.
5. Assert status, stable error/header/body shape, data visibility, and database side effects. A denied write must prove no forbidden mutation.
6. Fail the runner on any assertion. 按目标 Runbook 及已有授权处理本次隔离数据库；成功本身不授权清理需保留的测试数据。涉及共享登记引用临时宿主存储时，停止前明确处理动作并保留所需原存储，交还后完成[原入口的状态恢复核对](../../SKILL.md#4-回核并报告)。失败时记录保留名称与最小复现。
7. Generate the report format and location defined by the current runner/runbook. Include scenario, expected/actual, assertions, sanitized curl/request, response, database lifecycle, and PASS/FAIL.

## Gates

- A response recorder without assertions is not a test.
- Mocked repositories or in-memory fallback cannot support a real-database claim.
- Reports contain no passwords, tokens, API keys, or unmasked secrets.
- Test-only fixture writes stay inside the isolated runner and do not become production patterns.
- Cleanup touches only artifacts proven to belong to this workflow.

## Verify and close

Run only the checks required by the user-defined task and selected risk; do not widen to every available suite without an explicitly requested SystemTest task. Run `git diff --check` for repository changes. Report assertion failures separately from environment, credential, startup, migration, or fixture failures. An assertion failure against the defined behavior is a product or implementation defect; an environment/setup failure means real-database evidence is unavailable and does not by itself rewrite an earlier Development result. Report this task's execution type, database lifecycle, report path, exact commands/results, skipped checks, residual risk, repository state, and remaining task IDs; mention another task type only when actually established.

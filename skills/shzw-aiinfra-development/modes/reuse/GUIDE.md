# AiInfra Adoption

本模式的参考、脚本和资源位于加载结果的 resourceBase.path + "/modes/reuse"。命令工作目录与项目事实由当前责任项目入口确定；相对资源链接按本模式目录解析。

## Goal

Choose one grounded outcome for each need: reuse AiInfra directly, keep a thin product adapter, enhance AiInfra, migrate app code, or correct the app contract. Track only authorized work needing recovery in `文档/TASK_CONTROL.md`; evidence-backed uncommitted outcomes belong in `文档/WORK_CANDIDATES.md` only when later-work discovery needs them.

## Load

以下源码定位供公共包或平台维护者使用。普通应用消费使用已交付的公共 API、包文档和本模式能力参考；没有私有 checkout 不构成消费现有能力的前置失败。只有修改公共实现或证实公开合同无法满足需要时，再由责任项目定位内部源码。

1. 读取目标项目入口、当前任务和所用包的交付说明；维护 AiInfra 时再读取公共包责任项目入口。
2. 公共消费先读本模式能力参考与已交付包文档；修改 AiInfra 时再读责任仓库的 `文档/项目/项目_LLM_backend_packages/技术设计/DOC-0002-AiInfra基础职责边界与下游禁建清单.md`。
3. Before adding app-local infrastructure, read `references/capability-map.md`.
4. For runtime query or object metadata, read `references/runtime-query-and-object-metadata.md`.
5. Before changing a public contract, security model, schema, provider, or package, read `references/security-package-validation.md`.

Stop loading once the touched source, current contract, tests, and consumer are clear.

## Workflow

1. Identify the consumer, touched public surface, current package API, and affected task row.
2. 核对当前安装包的公开类型、导出、README 与最小调用后再判定缺口。维护公共实现时继续追源码、providers 和测试；消费者不能因无私有源码而被判为无法复用。
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

For a Development task, run the narrowest package tests, consumer build/tests, and isolated real-database evidence required by the changed risk, then run `git diff --check`. Test technique or breadth does not itself change the task type. Route to [shzw-testing](https://github.com/xingshukeji/skills-hub/blob/main/skills/shzw-testing/modes/system/GUIDE.md) only when the user explicitly requests an independent full-candidate, cross-consumer, release-gate, integration, system, or full-suite campaign. Formal package publication or downstream rollout requires an explicitly requested Deployment task using [shzw-delivery](https://github.com/xingshukeji/skills-hub/blob/main/skills/shzw-delivery/modes/deployment/GUIDE.md). Report this task's execution type, classifications, changed owners, package-consumer evidence, repository state, and remaining task IDs; mention other task types only when actually established.

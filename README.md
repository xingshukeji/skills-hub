# 苏宏助为 · Skills Hub

苏州苏宏助为智能科技有限公司面向 AI、企业开发者和合作伙伴提供的官方技能与 CLI。配合 XRain、XRain Workforce 的产品说明、开发文档和示例，支持业务二开、AI 定制与系统集成。[联系我们](https://xingshukeji.github.io/xrainTrain/contact)。

[产品与技术](https://xingshukeji.github.io/xrainTrain/products/) · [官方开发文档](https://xingshukeji.github.io/xrainTrain/developers/) · [SDK](https://xingshukeji.github.io/xrainTrain/developers/sdk) · [人员学习](https://xingshukeji.github.io/xrainTrain/learn) · [AI 开发指南](https://xingshukeji.github.io/xrainTrain/ai/) · [本仓 AI 文本入口](https://raw.githubusercontent.com/xingshukeji/skills-hub/main/llms.txt)

第一次使用，可把[统一文本索引](https://xingshukeji.github.io/xrainTrain/llms.txt)与具体业务需求交给 AI；支持 Skill 的工具从下表选取完整技能目录。课程解释怎样使用，技能指导怎样完成任务，正式参数查原专题、公开类型与当前环境。

技能统一使用 `shzw-` 前缀，表示苏宏助为，目录位于 `skills/shzw-<name>/`。本仓完整维护通用协作方法、工程开发与验证、学习内容审查，以及 XRain / Workforce 专用技能。安装和主动更新取默认分支；不设 skill 版本目录或 release，已安装副本不会自动更新。

## 产品、SDK 与技能的关系

XRain 是业务应用平台，支持新业务建模，也支持对管理完善的已有系统使用业务编排转接接口，无需新增业务数据模型。XRain Workforce 是人与 AI 协作产品，接入这些业务操作和已有企业服务。

SDK 是供代码使用的开发包，Skill 是供 AI 执行的任务方法，CLI 是终端工具。SDK 按项目制品渠道取得，不能从本仓公开推断 SDK 已在公共 npm 发布。具体取得方式与版本见[官方 SDK 文档](https://xingshukeji.github.io/xrainTrain/developers/sdk)。

本仓是下列技能、配套参考和 CLI 的唯一编写源。每项技能在元数据中保留维护公司和来源 URL；产品技能另列文档入口与关联产品。Workforce、all_in_one 和个人目录按实际需要安装完整消费副本，修改在本仓完成。平台、SDK 的实现和项目事实仍由所属项目维护。

## Skills

<!-- skills:start -->
| Skill | 用途 |
| --- | --- |
| [shzw-aiinfra-adoption](skills/shzw-aiinfra-adoption/SKILL.md) | Use when an existing XRain or other .NET app should consume LLM_backend_packages / AiInfra.Abp.* instead of rebuilding shared infrastructure. Trigger for overlap audits or migrations involving DI, UoW, data access, query/runtime records, permissions, RBAC/ABAC, audit, object projection, providers, package feeds, Storage, RAG, or ChatHub. |
| [shzw-aiinfra-project-init](skills/shzw-aiinfra-project-init/SKILL.md) | Use when creating a new greenfield .NET backend with LLM_backend_packages / AiInfra.Abp.*. Trigger for choosing the simple-api or layered-api scaffold, running the AiInfra scaffold CLI, wiring PostgreSQL and modules, validating package references, or adding the minimal workspace start/verify entry. Use shzw-aiinfra-adoption for an existing codebase. |
| [shzw-align-solution-direction](skills/shzw-align-solution-direction/SKILL.md) | Align a requested solution direction or resolve a material uncertainty about outcome, boundary, ownership, invariants or completion. Use when competing interpretations or conflicting evidence could change those decisions. Clear routine implementation needs only a brief direction check, without loading this full method. Independently check user and agent premises, missing variables, costs, and reasoning bias. |
| [shzw-audit-learning-content](skills/shzw-audit-learning-content/SKILL.md) | Audit, write or restructure self-study tutorials, textbooks, courses, learning paths and educational visuals for correctness, depth, navigation, duplication and information density. Use for 教程、课件、学习路线、自学、初学者、内容太浅或重复、可跳读、图解教学 and learner-facing content reviews. Exclude ordinary code docs, API references, release notes, pure copyediting and bug fixes unless instructional design is also requested. |
| [shzw-autonomous-project-decisions](skills/shzw-autonomous-project-decisions/SKILL.md) | 用户跨项目默认处置政策。执行研发、测试、部署运维或文档任务时，遇到账号创建与复用、临时凭据、同目标修复复测、端口占用、依赖失败、兼容限制、资源清理或重复流程确认，按具体默认选择自主继续；仅对超出政策的实质影响升级决定。 |
| [shzw-backend-detailed-testing](skills/shzw-backend-detailed-testing/SKILL.md) | Use for backend test evidence within a user-defined Development task, or as a scoped layer of an explicitly requested SystemTest task. Trigger for unit, integration, contract, isolated real-database, minimal real-host, smoke, missing coverage, or escaped regressions; choose the task type from the user's goal, never from the test technique or suite size. |
| [shzw-backend-realdb-api-testing](skills/shzw-backend-realdb-api-testing/SKILL.md) | Use when a user-defined Development task or explicitly requested SystemTest task needs assertion-backed backend API evidence against an isolated real database rather than mocks. Trigger for provider/schema/transaction behavior, response plus side-effect checks, or escaped production bugs; never infer the task type, a broad campaign, or deployment from use of a real database. |
| [shzw-challenge-solution](skills/shzw-challenge-solution/SKILL.md) | Use only when the user asks to challenge, rebut, stress-test or find flaws in an existing solution, architecture, migration, implementation or governance proposal. Review that exact artifact read-only for unsupported assumptions, scope expansion, ownership mistakes, missing evidence and avoidable complexity. Recommend the next step without rewriting, executing, persisting or treating the review as approval. |
| [shzw-cicd](skills/shzw-cicd/SKILL.md) | 查询、触发已有 Jenkins 流水线并跟踪构建、发布或部署；不编写流水线。 |
| [shzw-client-application-development](skills/shzw-client-application-development/SKILL.md) | Guide fast, bounded development of desktop, launcher, updater, native, mobile, and web clients. Use for Chinese requests about 技术选型、开发客户端、安装包、更新、版本、发布、签名、回滚、OSS or similar client delivery work. Keep reusable method rules here; load platform, distribution, and managed-runtime variants from references only when the request needs them. |
| [shzw-code-boundary-governance](skills/shzw-code-boundary-governance/SKILL.md) | Use when reviewing or changing backend Repository, Manager, AppService, Controller, Endpoint, DI, Application.Contracts, data-access, or provider boundaries. Trigger for architecture reviews, refactors, dependency-injection issues, AiInfra-versus-app ownership, XRain runtime/metadata paths, or suspected duplicated shared infrastructure. |
| [shzw-develop-managed-client-capability](skills/shzw-develop-managed-client-capability/SKILL.md) | Develop, debug, upgrade, package, release or review trusted application-managed client capabilities. Use when the application owns an internal extension’s executable, version, health, resources, lifecycle, tool declarations, artifacts, delivery, update UX or validation. Covers technology selection, doctor checks, installers, OSS distribution and official updates. Exclude ordinary app features, arbitrary third-party drop-ins, manager-only UI and unrelated installer work. |
| [shzw-document-governance](skills/shzw-document-governance/SKILL.md) | Use for document governance, 文档治理, controlled technical writing when creating or materially revising workspace documents, user-controlled task execution-type and activity-plan alignment, AGENTS/Workflow/StructureContract control planes, deleting absorbed process documents or reports, reducing prompt hot paths, classifying document Kind, or aligning TASK_CONTROL with current facts. |
| [shzw-engineering-boundaries](skills/shzw-engineering-boundaries/SKILL.md) | 审查并收敛工程职责、反复缺陷、文件消费边界、自建工具链和环境差异。用于复杂代码反复修补、历史热点审查、工程简化和跨层机制评审，以及新增启动、依赖、缓存、恢复或交付机制前的必要性判断；局部业务修改不触发整仓审计。 |
| [shzw-evolve-document-driven-workflow](skills/shzw-evolve-document-driven-workflow/SKILL.md) | Evolve workspace governance from a requested workflow improvement or a durable future-facing agent/process correction such as 以后必须、一律、统一、不要再. Distinguish discussion from authorized implementation by user intent and scope, not message count. Keep one-off product requirements local. |
| [shzw-git-closeout](skills/shzw-git-closeout/SKILL.md) | Use automatically after one independent task has a passing conclusion, required activity cleanup is finished, and file changes can be attributed exactly. Runs the only add/commit/fetch/push path in a child process, preserves unrelated changes, reports Git separately, and never treats a commit or push as SystemTest evidence or Deployment authorization. |
| [shzw-human-documentation](skills/shzw-human-documentation/SKILL.md) | 规划、创建、改写或审阅面向人的中文开发文档时使用，包括单一人类文档入口、上手指南、日常开发闭环、系统测试指南、README，以及要求真实前置条件、明确值、无占位符、可观察结果和短步骤的发布、安装或部署指南；必须分开 Development、SystemTest、Deployment，不用于 ProductContract、CurrentDesign、Workflow、Runbook、AGENTS 或单纯的代码解释。 |
| [shzw-integrate-workforce-application](skills/shzw-integrate-workforce-application/SKILL.md) | 在 XRain Workforce 开发环境将独立应用接入应用中心，或修复已有接入时使用。按既有配置完成独立应用身份、统一登录、目录贡献、启动与真实验证。普通页面修改、仅查看应用列表及正式部署不触发此技能。 |
| [shzw-release-deployment](skills/shzw-release-deployment/SKILL.md) | Govern or execute an explicitly authorized Deployment of one approved artifact to one named target with verified admission evidence, rollback, and minimal post-deployment checks. Use for formal package publication, environment migration, release, rollout, cutover, rollback, or other target-environment changes; never trigger from development completion, test success, Git push, or artifact creation alone. |
| [shzw-replicate-workspace](skills/shzw-replicate-workspace/SKILL.md) | Use when initializing or repairing a document-driven workspace control plane and its grounded human entry from an existing AGENTS.md/TASK_CONTROL/StructureContract/Workflow model. Trigger for 复刻工作空间, 初始化工作空间, 文档驱动开发, dual documentation surfaces, or control-plane upgrades. Do not infer product design, stack, APIs, source skeletons, services, or implementation directories. |
| [shzw-runtime-stability](skills/shzw-runtime-stability/SKILL.md) | 为运行稳定性调查、资源释放审查及负载、长时间运行、故障恢复验证选择场景、指标和判定依据。用于内存持续增长、容量与延迟、积压、取消、生命周期及依赖故障；不因一次部署或普通局部修改自动展开全套测试。 |
| [shzw-service-starter](skills/shzw-service-starter/SKILL.md) | Use when starting, stopping, restarting, checking, diagnosing, building, or locally verifying workspace services through root package.json scripts for a user-defined Development task or explicitly requested SystemTest task. Trigger for XRain or standalone frontend operations; formal publication, target migration, rollout, cutover, and rollback route to shzw-release-deployment instead. |
| [shzw-system-testing](skills/shzw-system-testing/SKILL.md) | Run or govern a SystemTest task only when the user explicitly asks for an independent integration, system, full-suite, candidate-acceptance, release-gate, or regression result against existing code. Choose control strength and persistence independently; never infer authority from a candidate list, CI, a release gate, test tooling, or suite size. |
| [shzw-technical-solution](skills/shzw-technical-solution/SKILL.md) | Produce a requested technical solution or the working plan for a controlled technical change under WF-0002. Preserve the established direction and proceed within explicit implementation authorization. Ordinary implementation does not require this skill. Explicit solution-artifact requests and read-only discussion retain their own delivery boundaries. |
| [shzw-upgrade-dsh](skills/shzw-upgrade-dsh/SKILL.md) | 用户主动调用的 DSH 升级评估与实施：盘点包、复制源码、插件协议和外部 Runtime，分析上游差异，在升级过程中验证受影响行为。不自动触发，不等待上线前。 |
| [shzw-verify-workforce-composition](skills/shzw-verify-workforce-composition/SKILL.md) | 在 XRain Workforce 开发、修复或验收插件装配、重组、裁剪、门户组合及其生命周期时使用。执行依赖组合矩阵，并通过内置浏览器真实登录和业务操作核验；不以构建、模块注册或测试数量代替用户功能证据。 |
| [shzw-workforce-agent-troubleshoot](skills/shzw-workforce-agent-troubleshoot/SKILL.md) | 排查 Workforce 智能体不回复、不跟进、工具失败、重复消息、会话混淆和接管后迟到写入。 |
| [shzw-workforce-business-development](skills/shzw-workforce-business-development/SKILL.md) | 基于 XRain 与 Workforce 落地企业业务，按现状选择免建模的接口编排、新业务建模或混合接入，再完成所需授权、逻辑、页面与智能体工具。 |
| [shzw-workforce-business-review](skills/shzw-workforce-business-review/SKILL.md) | 审查 XRain Workforce 的业务实现、工程职责与退役影响。按当前成员与租户、消息与 AI、Task、应用组合、业务资料和启动交付定位正式规则、真实入口、源码及验证证据。用于平台 review 和修复收口；局部问题只检查受影响业务链。 |
| [shzw-workforce-runtime](skills/shzw-workforce-runtime/SKILL.md) | 启动、恢复和验收 Workforce 环境，核对部署效果，定位慢页面、慢登录、慢会话及实例资源增长。 |
| [shzw-xrain-access-diagnosis](skills/shzw-xrain-access-diagnosis/SKILL.md) | 排查 XRain 登录后的 403、应用准入、角色与数据范围、执行身份和机器人权限；支持授权修复与撤权复测。 |
| [shzw-xrain-app-operations](skills/shzw-xrain-app-operations/SKILL.md) | 处理 XRain 已发布应用的租户安装、升级、冲突、中断恢复、组件恢复和卸载；不构建服务镜像。 |
| [shzw-xrain-app-package](skills/shzw-xrain-app-package/SKILL.md) | 在任意项目编写和离线校验 XRain .appkg 应用源码与制品，使用目标提供的统一构建端点生成服务端制品，并按明确授权导入、安装和恢复应用。不用于部署 XRain 服务镜像或任意程序二进制。 |
| [shzw-xrain-auth](skills/shzw-xrain-auth/SKILL.md) | 通过 XRain 认证中心网页准备或恢复固定身份、激活登录、修复 OIDC 接入，并验证原应用登录。 |
| [shzw-xrain-business-user-lifecycle](skills/shzw-xrain-business-user-lifecycle/SKILL.md) | 在 XRain/Workforce 落地业务人员接入、实际使用、协作与职责变更的完整业务主线，连接固定身份、租户成员、应用准入、业务授权和持续维护。单独登录、403 或权限定位使用对应诊断能力。 |
| [shzw-xrain-cli](skills/shzw-xrain-cli/SKILL.md) | 用自带 CLI 连接 XRain 平台或应用市场，操作平台用户、权限、数据及应用包；认证中心账号由 shzw-xrain-auth 处理。 |
| [shzw-xrain-code-review](skills/shzw-xrain-code-review/SKILL.md) | 审核 XRain 前后端、diff 或 PR；项目级审核追踪完整调用链，重复审核自动反思并补查。不用于纯方案评审。 |
<!-- skills:end -->

每次只加载与当前任务相关的入口和参考。Workforce 从加载结果的 `resourceBase.path` 读取资源；skill 不增加员工工具权限。验收与测量已合入 shzw-workforce-runtime，旧安装中的 workforce-verify/workforce-performance 可在更新时移除。

业务落地先找所属项目已确认的完整主线与差异。`shzw-xrain-business-user-lifecycle` 承载人员从接入到实际工作、协作和职责变更的通用主线；`shzw-workforce-business-development` 沿业务结果组织实现，其余专业能力按当前环节调用。具体业务的长主线及非通用决策仍由所属项目保存，单独诊断可直接进入对应技能。

## 安装与使用

将所需 skill 整个目录复制到宿主 skills 目录，或通过安装器使用 `xingshukeji/skills-hub` 的 `skills/shzw-<name>` 路径。目录名、SKILL.md 的 name 与调用名保持一致。更新已有安装时替换完整目录并移除旧名称，避免同名旧副本继续参与发现。

技能自带的参考、脚本和资源都随目录交付。项目开发类技能通过目标项目入口读取其源码、文档和命令；技能安装位置不决定目标项目。按条件使用其他方法时，读取已安装的 `shzw-*` 技能或所链接的本仓来源。个人默认处置政策只适用于明确采纳它的用户，不随安装转移账号或外部操作授权。

```text
node "<安装目录>/shzw-xrain-cli/scripts/xrain-cli.mjs" --help
```

XRain CLI 和 JavaScript 辅助脚本需要 Node.js 22.12+，推荐 24；CLI 依赖已打包，使用端无需 npm install 或 .NET。`shzw-xrain-app-package` 的独立离线校验工具需要 .NET 10 SDK；开发类技能采用目标项目声明的工具链。当前 Workforce 开发宿主自身要求 Node.js 24；Windows CLI 会话保护仍使用系统 PowerShell。

## 维护与验证

源码在 src/xrain-cli，生成制品与第三方声明在 skills/shzw-xrain-cli/scripts，不手工修改生成文件。

```text
npm ci
npm run build
npm run index
npm run check
```

index 同时生成上方目录与 llms.txt 的完整技能入口；check 核对制品、命名、独立目录、链接及模拟服务测试。validate -- --skill <name> 可单查一个入口，CI 仍查全部。应用包离线工具变更后运行 `npm run test:appkg`。合并同名技能时保留内容最后修改的完整版本，并核对脚本与参考，不能仅比较 SKILL.md 或目录复制时间。

可选 `npm run verify:workforce -- --provider <真实加载器路径>` 检查独立复制后的加载，这是维护检查，不是 skill 使用依赖。离线场景及历史结果见 [能力复核](evals/workforce/CAPABILITY-AUDIT.md) 和 [首轮报告](evals/workforce/REPORT.md)；实验工具位于 tools/evaluate-skills.mjs、tools/capability-lab.mjs，运行材料放忽略目录 .local-validation。

真实服务检查 `npm run verify:live -- --help` 仅供明确授权的本机验证，必须先按目标生效账号规则核对配置与固定身份。脚本的历史回环默认值和旧验收不代表当前开发或部署架构；普通 check 不访问真实账号或租户。

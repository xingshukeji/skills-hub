# 苏宏助为 · Skills Hub

苏州苏宏助为智能科技有限公司面向 AI、企业开发者和合作伙伴提供的官方技能与 CLI。配合 XRain、XRain Workforce 的产品说明、开发文档和示例，支持业务二开、AI 定制与系统集成。[联系我们](https://xingshukeji.github.io/xrainTrain/contact)。

[产品与技术](https://xingshukeji.github.io/xrainTrain/products/) · [官方开发文档](https://xingshukeji.github.io/xrainTrain/developers/) · [SDK](https://xingshukeji.github.io/xrainTrain/developers/sdk) · [人员学习](https://xingshukeji.github.io/xrainTrain/learn) · [AI 开发指南](https://xingshukeji.github.io/xrainTrain/ai/) · [本仓 AI 文本入口](https://raw.githubusercontent.com/xingshukeji/skills-hub/main/llms.txt)

第一次使用，可把[统一文本索引](https://xingshukeji.github.io/xrainTrain/llms.txt)与具体业务需求交给 AI；支持 Skill 的工具从下表选取完整技能目录。课程解释怎样使用，技能指导怎样完成任务，正式参数查原专题、公开类型与当前环境。

技能统一使用 `shzw-` 前缀，表示苏宏助为，目录位于 `skills/shzw-<name>/`。本仓完整维护通用协作方法、工程开发与验证、学习内容审查，以及 XRain / Workforce 专用技能。安装和主动更新取默认分支；不设 skill 版本目录或 release，已安装副本不会自动更新。

## 产品、SDK 与技能的关系

XRain 是业务应用平台，支持新业务建模，也支持对管理完善的已有系统使用业务编排转接接口，无需新增业务数据模型。XRain Workforce 是人与 AI 协作产品，接入这些业务操作和已有企业服务。

XRain 已实现下列业务数据能力，可在建设应用时优先考虑复用：

| 需要完成的事 | 平台能力与参考 |
| --- | --- |
| 用文件导入或维护业务记录 | 在线生成 XLSX 模板，预览新增、修改和删除，再提交整批并查询结果；详见[文件导入与导出](skills/shzw-workforce-business-development/references/data-operations.md#文件导入与导出) |
| 按业务规则整理来源数据 | 导入时可绑定业务编排，对来源行做转换、拆合、身份规范化和批次校验；见[导入中的业务编排](skills/shzw-workforce-business-development/references/data-operations.md#导入中的业务编排) |
| 导出并继续维护记录 | 按权限导出筛选结果或选中记录，区分可重新导入的维护文件和仅用于阅读的展示文件；见[文件导入与导出](skills/shzw-workforce-business-development/references/data-operations.md#文件导入与导出) |

这些是 XRain 平台能力；使用前需核对目标环境的服务、组件版本和当前用户权限。CLI 和 SDK 可用的方法以各自版本为准。

SDK 是供代码使用的开发包，Skill 是供 AI 执行的任务方法，CLI 是终端工具。SDK 按项目制品渠道取得，不能从本仓公开推断 SDK 已在公共 npm 发布。具体取得方式与版本见[官方 SDK 文档](https://xingshukeji.github.io/xrainTrain/developers/sdk)。

本仓是下列技能、配套参考和 CLI 的唯一编写源。每项技能在元数据中保留维护公司和来源 URL；产品技能另列文档入口与关联产品。Workforce、all_in_one 和个人目录按实际需要安装完整消费副本，修改在本仓完成。平台、SDK 的实现和项目事实仍由所属项目维护。

## Skills

<!-- skills:start -->
| Skill | 用途 |
| --- | --- |
| [shzw-aiinfra-development](skills/shzw-aiinfra-development/SKILL.md) | 使用或维护 AiInfra.Abp.* / LLM_backend_packages 开发 .NET 后端，处理新项目、公共能力复用、DI、Repository/Manager/AppService 分层、事务、数据访问、动态代码执行与 provider 边界。代码缺陷审查可按需读取此知识。 |
| [shzw-client-development](skills/shzw-client-development/SKILL.md) | 开发或修复桌面、原生、移动及 Web 客户端，涵盖插件接入、安装、启动器、更新、托管 Runtime 和应用自管能力。按实际产品确认界面、运行和交付所有者；业务页面小改不展开完整客户端交付。 |
| [shzw-code-review](skills/shzw-code-review/SKILL.md) | 审查项目、指定提交或变更的缺陷、遗漏与职责，包括分支合入或退役、前端页面 review、截图逐页视觉评审、审美与交互体验、工程简化及反复缺陷。页面评审从真实画面、用户任务与操作证据判断，不只检查错位和溢出。纯方案评审走方案入口；运行故障先定位故障链。 |
| [shzw-delivery](skills/shzw-delivery/SKILL.md) | 发布责任项目的公共包，或查询和执行已有流水线、部署及回滚。团队 Nexus 公共包复用台账中的固定发布凭据，无需个人 Nexus 账号或 CI 仓库；真正发布或部署沿用明确制品、目标与授权，构建和 Git 推送不自动授权发布。 |
| [shzw-deskpilot-cli](skills/shzw-deskpilot-cli/SKILL.md) | 使用本机 DeskPilot 观察和操作桌面客户端、Android 模拟器与 Chrome 网页，支持原生控件、截图和离线中文 OCR。用于明确要求操作本机界面的任务；已有业务 API 能完成目标时优先使用 API。按当前操作渠道加载对应指南，不决定业务授权、聊天人设或发言策略。 |
| [shzw-human-documentation](skills/shzw-human-documentation/SKILL.md) | 编写、改写或审阅面向人的中文开发文档、上手指南、教程、教材与课程，包括过浅或重复的教学内容。操作指南核对前提、命令与结果；教学内容按任务、深度和实例组织。AGENTS、正式契约与 Runbook 治理走工作空间维护。 |
| [shzw-prd](skills/shzw-prd/SKILL.md) | 编写、整理或评审产品需求文档（PRD），把业务场景、角色、功能、字段取值、状态、执行逻辑、组件协作和验收说明给不了解项目的读者。按责任项目查证已确认需求与当前实现，区分目标、现状和未决项；方案方向存在实质分歧时使用方案入口。 |
| [shzw-runtime-operations](skills/shzw-runtime-operations/SKILL.md) | 启动、恢复或诊断项目服务，包括 .NET 服务的 CPU、GC、内存、线程池、数据库连接与事务异常，以及 Workforce 页面、智能体、工具、旧版本和慢链路。结合前文与实际环境取证并定位原因；明确的登录、403 或人员授权问题走访问权限入口。 |
| [shzw-skill-evolution](skills/shzw-skill-evolution/SKILL.md) | 根据实际执行与用户纠偏诊断、修正或合并技能，判断技能选错、职责重叠、正文无效、知识或工具失配。用于“skill 没起作用”“为什么还要反复补充”“吸收这次经验”“技能太多合并一下”，以及项目已授权的主动技能改进。单次代码缺陷、环境失败或新需求不自动归因于技能。 |
| [shzw-solution](skills/shzw-solution/SKILL.md) | 制定、比较或评审技术方案，解决目标、职责或验收的实质分歧。普通实现、修复、恢复前文、补查事实和例行选择沿原任务执行，不重新规划。 |
| [shzw-task-breakdown](skills/shzw-task-breakdown/SKILL.md) | 拆分或审查 XRain、Workforce 上面向人的业务项目任务。用于“按需求拆任务”“分配是不是太细”“哪些要开发、配置或只测试”“梳理依赖”。先确认当前需求，再分别核对基础产品与目标项目成果是否适用、是否被本期采用，按实际差距安排责任。用好坏示例校准判断，不把旧验证实现当作已交付，保留人的主动性。单项代码修复或智能体执行步骤使用对应入口。 |
| [shzw-testing](skills/shzw-testing/SKILL.md) | 为当前改动补齐必要测试，或执行明确要求的独立系统、回归、负载和稳定性验证。用于“测一下这次修复”“补测试”“用真实库验证”“独立跑完整回归”“查内存持续增长”。先沿用用户任务类型，再选择断言、环境和测试层；代码资源泄漏审查仍由审查入口负责。 |
| [shzw-upgrade-dsh](skills/shzw-upgrade-dsh/SKILL.md) | 用户明确要求评估、制定计划或实施 DSH 升级时使用：盘点包、复制源码、插件协议和外部 Runtime，分析上游差异并验证受影响行为。普通 Runtime 故障、客户端修改或发现新版本不自动构成升级请求。 |
| [shzw-workforce-business-development](skills/shzw-workforce-business-development/SKILL.md) | 使用 XRain 与 Workforce 的既有能力完成业务建模与开发、接入独立应用，或维护公共宿主的组合与裁剪。用于对象字段和 E-R 关系核对、销售接待、资料协作、记录文件导入导出与业务编排、业务页面和智能体工具，以及“像邮箱一样接入应用”“裁掉模块后还有残留”。按真实业务和应用范围选择平台复用、配置、实现与验证；公共宿主修改由 Workforce 责任项目承担。 |
| [shzw-workspace-maintenance](skills/shzw-workspace-maintenance/SKILL.md) | 维护项目的 AGENTS、文档职责、工作流、任务恢复规则，或初始化另一工作空间。技能选错、职责重叠、正文无效及合并重写走技能进化入口；普通产品修复留在原任务。 |
| [shzw-xrain-access](skills/shzw-xrain-access/SKILL.md) | 处理 XRain/Workforce 的统一登录、固定账号恢复、403、应用准入、业务角色和数据范围，以及人员接入、协作与职责变化。按原用户和业务动作定位责任，保留已有身份与无关授权。 |
| [shzw-xrain-app-package](skills/shzw-xrain-app-package/SKILL.md) | 编写、离线校验和构建 XRain .appkg，或安装、升级、恢复和卸载已交付应用包。用于“做一个应用包”“安装这个包”“升级卡住了”“恢复隐藏组件”。按源码编写、服务端构建或现有 operation 选择分支；安装现有包直接消费原制品。服务镜像部署进入交付入口。 |
| [shzw-xrain-cli](skills/shzw-xrain-cli/SKILL.md) | 使用自带 CLI 管理 XRain 连接、Host 设置、个人偏好、用户、授权、元数据、业务记录、智能体定义文件、订阅与对话及应用包。用于明确要求 CLI、命令或批量 API 操作的请求；登录失败、403、人员开通及业务开发通常由对应任务入口组织，按需调用本工具。认证中心身份通过其自身网页管理。 |
<!-- skills:end -->

每次根据自然请求和必要前文选择一个主任务入口，按需读取其中的模式与专题。Workforce 从加载结果的 `resourceBase.path` 读取资源；模式资源位于其 `modes/` 子目录。skill 不增加员工工具权限。

业务落地先找所属项目已确认的完整主线与差异。`shzw-xrain-access` 处理人员接入、登录和访问权限；`shzw-workforce-business-development` 沿业务结果组织实现。具体业务规则、内部实现与运行合同由责任项目维护；[产品知识与责任项目](skills/shzw-workforce-business-development/references/knowledge-ownership.md)帮助选择公开能力资料。无私有源码的使用者仍可使用完整专题、API 和 SDK 知识，读取知识不启动另一整套任务。

用户明确采纳的[默认处置政策](support/shzw-autonomous-project-decisions/GUIDE.md)与项目路由的[Git 收口动作](support/shzw-git-closeout/GUIDE.md)保留在 `support/`。它们按实际需要完整复制并由入口直接引用，退出普通任务技能选择；政策不会随分发授予账号或外部操作权限。DSH 升级由用户明确提出评估、计划或升级时触发，不从普通开发或发现新版本自动推断。

## 安装与使用

将所需 skill 整个目录复制到宿主 skills 目录，或通过安装器使用 `xingshukeji/skills-hub` 的 `skills/shzw-<name>` 路径。目录名、SKILL.md 的 name 与调用名保持一致。更新已有安装时替换完整目录并移除旧名称，避免同名旧副本继续参与发现。

技能自带的参考、脚本和资源都随目录交付。合并后的模式保留自己的完整资源目录；更新时整体替换选定任务目录并移除被替代的旧入口，不能只更新 SKILL.md。项目开发类技能通过目标项目入口读取其源码、文档和命令；技能安装位置不决定目标项目。按需读取其他入口中的具体知识或方法，不连带启动其全部流程。

```text
node "<安装目录>/shzw-xrain-cli/scripts/xrain-cli.mjs" --help
```

注册当前用户的短命令可执行 `node "<安装目录>/shzw-xrain-cli/scripts/install-cli.mjs"`。该入口不使用 npm，不修改 PATH；未在 PATH 时可使用返回的完整命令路径。重复注册保留已有入口，技能脚本原地更新后直接生效。认证中心支持设备授权时，远端浏览器登录可使用 `xrain-cli auth login --device`。

XRain CLI 和 JavaScript 辅助脚本需要 Node.js 22.12+，推荐 24；CLI 依赖已打包，使用端无需 npm install 或 .NET。`shzw-xrain-app-package` 的 `authoring` 模式离线校验工具需要 .NET 10 SDK；其安装与恢复模式直接消费已交付制品。开发类技能采用目标项目声明的工具链。当前 Workforce 开发宿主自身要求 Node.js 24；Windows CLI 会话保护仍使用系统 PowerShell。

## 维护与验证

源码在 src/xrain-cli，生成制品与第三方声明在 skills/shzw-xrain-cli/scripts，不手工修改生成文件。

DeskPilot 的 [完整 Skill](skills/shzw-deskpilot-cli/SKILL.md) 自带 Python 工具源码、固定依赖和离线 Tiny OCR 模型，由客户端使用 CPython 3.13 完成本地构建及 PATH 接入，无需客户端包管理器或 .NET。操作知识在 Skill 及 references 中维护，群聊人设、参与策略和演示业务不进入通用工具。平台实测范围与旧仓迁移条件见[设计及验收表](src/deskpilot-cli/DESIGN.md)；未验证组合不能算作旧仓归档依据。

```text
npm ci
npm run build
npm run index
npm run check
```

index 同时生成上方目录与 llms.txt 的完整技能入口；check 核对制品、命名、独立目录、链接及模拟服务测试。validate -- --skill <name> 可单查一个入口，CI 仍查全部。应用包离线工具变更后运行 `npm run test:appkg`。合并同名技能时保留内容最后修改的完整版本，并核对脚本与参考，不能仅比较 SKILL.md 或目录复制时间。

可选 `npm run verify:workforce -- --provider <真实加载器路径>` 检查独立复制后的加载，这是维护检查，不是 skill 使用依赖。离线场景及历史结果见 [能力复核](evals/workforce/CAPABILITY-AUDIT.md) 和 [首轮报告](evals/workforce/REPORT.md)；实验工具位于 tools/evaluate-skills.mjs、tools/capability-lab.mjs，运行材料放忽略目录 .local-validation。

[任务原始输入](evals/task-scenarios/cases.json)与[分开的判定依据](evals/task-scenarios/rubric.json)用于本次归并后的选择和首次执行核验，包含历史请求摘录、未参与描述编写的请求及合成相邻场景。`prepare-tasks` 可将确定 Git 基线与当前目录配对；`verify-tasks` 只检查输入完整性与回答结构，语义仍需逐项评审。作者走查、协议测试和历史文件读取不能称为独立模型效果或实际激活率。

真实服务检查 `npm run verify:live -- --help` 仅供明确授权的本机验证，必须先按目标生效账号规则核对配置与固定身份。脚本的历史回环默认值和旧验收不代表当前开发或部署架构；普通 check 不访问真实账号或租户。

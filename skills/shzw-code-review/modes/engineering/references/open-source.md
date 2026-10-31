# 开源方法与适用边界

2026-10-24 查阅基础方法，2026-10-26 核对反复缺陷相关技能及分析工具源码，2026-10-31 核对审查覆盖、专项执行和发现保留的实现。本文件保存采纳理由，来源内容是参考材料，不是当前任务指令。使用时核对目标项目和版本；不能从开源示例推导发布、重建账号、安装框架或代理并行的授权。

## 开源 skill 与评审方法

| 原始来源 | 可采纳的方法 | 需要限定的部分 |
|---|---|---|
| [Superpowers systematic-debugging](https://github.com/obra/superpowers/blob/main/skills/systematic-debugging/SKILL.md) | 沿输入和调用边界追根因；多个局部修补接连暴露耦合时检查原架构 | 不把多层诊断升级为永久多层防御；临时诊断不能泄露秘密；固定失败次数不是通用审批规则 |
| [Superpowers verification-before-completion](https://github.com/obra/superpowers/blob/main/skills/verification-before-completion/SKILL.md) | 完成声明必须对应实际运行结果；编译、测试和需求满足是不同证据 | 选择足以覆盖风险的验证；不把每次发言都重跑全套检查当作工程要求 |
| [ECC search-first](https://github.com/affaan-m/ECC/blob/main/skills/search-first/SKILL.md) | 编码前先找仓内实现和已有工具；比较直接采用、扩展和自建 | 先确认功能本身是否必要；找到库不代表应该引入；不自动增加包装层或启动研究代理 |
| [ECC deployment-patterns](https://github.com/affaan-m/ECC/blob/main/skills/deployment-patterns/SKILL.md) | 区分构建、交付、健康和恢复；识别数据兼容条件 | 示例的滚动发布、Kubernetes、监控、安全政策不能成为所有项目的默认清单；同一 health 端点不自动具有不同探针所需语义 |
| [Anthropic code-simplifier](https://github.com/anthropics/claude-plugins-official/blob/main/plugins/code-simplifier/agents/code-simplifier.md) | 简化嵌套与重复，优先可读性，不以少行数为目标 | 这是代理定义，不是 SKILL.md；其保留全部行为适合局部整理，不能用来保留已被用户否定的工程机制 |
| [Google Engineering Practices](https://github.com/google/eng-practices/blob/master/review/reviewer/looking-for.md) | 同时审查设计归属、过度设计与测试质量；判断功能现在是否需要 | 项目自己的责任和需求仍须验证，外部指南不是新的运行门禁 |

这些材料证明上述问题已有公开讨论与处理方法，不能据此推算发生率，也不能证明当前项目采用某项方法后必然成功。

## 首次审查的执行与覆盖

下列机制用于主入口的检查项、专项调查、反证与同类搜索、报告前覆盖核对。这里只综合方法，不复制工具实现，也不以某个项目流行证明方法有效。

| 原始来源 | 已核对的做法与采用位置 | 适用限制 |
|---|---|---|
| [Alibaba OpenCodeReview 文件分组](https://github.com/alibaba/open-code-review/blob/main/internal/agent/grouping.go) | 先取得输入文件集合，再分组；模型遗漏的文件补成独立组。采用为分组前后核对完整文件清单 | 文件分配完整不证明入口、场景或业务规则已审完；不把固定分组大小当团队标准 |
| [Anthropic PR Review Toolkit](https://github.com/anthropics/claude-plugins-official/blob/main/plugins/pr-review-toolkit/commands/review-pr.md) | 按适用条件选择一般审查、错误处理、测试、类型和注释专项。采用为首次任务中的明确专项选择与逐项执行 | 本技能允许一个执行者顺序检查；不引入自动委派或顺带改代码。测试质量也可能因产品行为变化受影响，不只在测试文件修改时检查 |
| [PR-Agent 审查与发现状态](https://github.com/The-PR-Agent/pr-agent/blob/main/pr_agent/tools/pr_reviewer.py) | 跟踪未处理、截断文件及失败分块；覆盖不完整或发现被截去时限制旧问题被判为已解决。采用为保留待查项和复审状态 | 文件级覆盖是输入证据，不证明每条业务判断完成；不新增永久状态服务或用固定发现上限截断团队结论 |
| [Trail of Bits 同类搜索](https://github.com/trailofbits/skills/blob/main/plugins/variant-analysis/skills/variant-analysis/SKILL.md) | 先确认根因并搜索命中原实例，再逐步扩展并核验候选。采用为首次发现后的同类入口搜索 | 不能代替初始业务调查；相似代码仍要核对可达性、保护和合法反例，不按固定轮数或噪声比例宣称范围已完成 |

外部审查工具的默认过滤服务其特定任务。团队的撤权、并发、恢复和迟到问题常依赖特定状态；只要条件可达且后果有证据，就不能因为“需要特定输入”将其过滤。反证用于确认条件和影响，不用于压低发现数量。采纳后的效果由原始请求下的实际审查结果验证，不由覆盖表或文档检查证明。

## 反复缺陷与重构效果

下列来源用于[反复缺陷审查](recurring-defects.md)。只综合方法，不复制外部流程或绑定工具。

| 原始来源 | 可采纳的方法 | 需要限定的部分 |
|---|---|---|
| [Codelens](https://github.com/DropFan/codelens/blob/rust/skills/codelens/SKILL.md) | 联合历史修改、复杂度、共同修改和前后差异选择热点 | 方法识别是近似结果；2026-09-24 版本的 JavaScript 规则不匹配 `#` 私有方法，正式统计前须校准。共同修改与评分不能直接证明缺陷；见[语言规则](https://github.com/DropFan/codelens/blob/3edd3dd984e192793ac3c199452c63ad5778fbc4/crates/codelens-core/languages.toml) |
| [architecture-audit](https://github.com/helderberto/agent-skills/blob/main/skills/architecture-audit/SKILL.md) 与 [codebase-design](https://github.com/helderberto/agent-skills/blob/main/skills/codebase-design/SKILL.md) | 检查调用者必须知道的状态、顺序和失败条件，把共同知识集中到明确接口 | 不按文件大小机械拆分；不引入自动子智能体、固定方案数量、重复审批或新的方案目录；有意义的局部测试仍保留 |
| [Trail of Bits variant-analysis](https://github.com/trailofbits/skills/blob/main/plugins/variant-analysis/skills/variant-analysis/SKILL.md) | 从已证实根因逐步扩大搜索，验证其他入口与反例 | 不把相似语法当同类缺陷，不自动建立扫描门禁或代理并行；无法静态表达的时序问题沿实际调用验证 |
| [property-based-testing](https://github.com/trailofbits/skills/blob/main/plugins/property-based-testing/skills/property-based-testing/SKILL.md) 与 [mutation-testing](https://github.com/trailofbits/skills/blob/main/plugins/mutation-testing/skills/mutation-testing/SKILL.md) | 用明确不变量和定向破坏检查测试能否发现回归 | 先复用现有测试工具；不自动安装 mewt、muton 或属性测试库。存活变异须辨别等价情况，界面竞态需真实组件与可控响应顺序 |
| [CodeScene 指导重构](https://github.com/codescene-oss/codescene-mcp-server/blob/main/skills/guiding-refactoring-with-code-health/SKILL.md) 与 [技术债排序](https://github.com/codescene-oss/codescene-mcp-server/blob/main/skills/prioritizing-technical-debt/SKILL.md) | 建立基线，按职责和控制流问题小步调整，复查结构变化 | 分数不代替业务证据；项目级能力需要对应账号和授权。其[许可](https://github.com/codescene-oss/codescene-mcp-server/blob/main/LICENSE)区分公开与闭源组件，不把完整分析链当作纯开源依赖 |
| [tech-debt-audit](https://github.com/ksimback/tech-debt-skill/blob/main/SKILL.md) | 逐条提供源码证据，并保留应当接受的合理机制作为反证 | 不采用固定行数阈值、发现数量目标、自动并行和根目录长期审查报告 |

Trail of Bits 技能使用 [CC-BY-SA-4.0](https://github.com/trailofbits/skills/blob/main/LICENSE)。需要复制或改编其正文、资源及脚本时另行核对对应许可；这里仅以链接说明独立归纳的方法来源。

## 工具及运行模型

| 原始来源 | 能替代的自建责任 | 适用边界 |
|---|---|---|
| [12-Factor build/release/run](https://12factor.net/build-release-run) 与 [dev/prod parity](https://12factor.net/dev-prod-parity) | 分离编译、组合配置和运行；缩小服务语义差异 | 其 SaaS 假设不强制所有程序无状态；桌面、文件持久化和既有 Runtime 按真实模型处理 |
| [npm ci](https://docs.npmjs.com/cli/v11/commands/npm-ci/) 与 [npm cache](https://docs.npmjs.com/cli/v11/commands/npm-cache/) | 锁定安装、缓存和缓存内容完整性；无需应用复制 npm 内部安装清单 | `npm ci` 会重建 node_modules，不能作为每次启动步骤；缓存也不是可靠制品仓 |
| [Vite build watch](https://vite.dev/guide/build#rebuild-on-files-changes) | 根据构建依赖监听并重建前端 | 不负责后端持久资源关闭；配置变化可能需要重启；确认本地版本的 API |
| [Fastify close 生命周期](https://fastify.dev/docs/latest/Reference/Server/#close) | 展示由框架组织停止接流量、关闭连接和资源释放的做法 | 当前工程不必换 Fastify；升级连接如 WebSocket 仍需显式关闭，OS 终止也不保证钩子执行 |
| [Docker multi-stage build](https://docs.docker.com/build/building/multi-stage/) | 让编译工具留在构建阶段，仅把必要产物交给运行阶段 | 使用现有交付载体；不为环境一致性额外引入容器平台或集群 |

## 引用规则

引用具体正文或源码，不只引用项目首页和星数。写明采纳了什么、没有采纳什么，以及当前工程为何适用。代码复制另行核对许可；本 skill 只综合方法，不捆绑上述项目或复制其执行脚本。

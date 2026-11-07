---
name: shzw-runtime-operations
description: 启动、恢复、诊断或优化项目服务，校准、矫正或纠偏运行故障与性能判断，包括 CPU、内存、IO、吞吐与延迟，以及 .NET 的 GC、线程池、数据库连接与事务异常，以及 Workforce 页面、智能体、工具、旧版本和慢链路。结合前文与实际环境取证并定位原因；明确的登录、403 或人员授权问题走访问权限入口。
metadata:
  maintainer: 苏州苏宏助为智能科技有限公司
  source: https://github.com/xingshukeji/skills-hub/blob/main/skills/shzw-runtime-operations/SKILL.md
  documentation: https://xingshukeji.github.io/xrainTrain/developers/skills
  products: XRain Workforce, XRain Agent Runtime
---

# 运行排障

先读取当前目标项目的启动和运行入口，核对已运行实例、配置及源码或制品身份。Workforce 默认使用其根一键启动；all_in_one 默认服务由其入口决定。不得因技能安装位置、同名服务或默认端口选择另一个项目。

Workforce 当前默认路径是本机统一宿主连接共享测试平台、统一认证和模型服务。先从根启动配置确认实际应用和构建来源；默认开发入口按 Runbook 自动准备当前公共源码，再启动实际应用。“还是旧效果”要核对消费来源、前端构建与后端进程，再按 Runbook 刷新或正常重启，不要求开发者另行手工打包或配对公共包。不要因此重装应用包、初始化账号或重建 Runtime。连接检查只证明依赖可达，恢复结论仍来自原业务动作。

帮助新电脑准备并启动已有项目时，沿[启动与连接](modes/workforce/references/startup.md)核对实际依赖、入口、配置和状态；终端输入被拒绝或停止未完成时，同样从该方法区分工具限制、动作授权及受支持的关闭入口。页面无智能体时继续核对[员工与会话配置](modes/agents/references/agent-session.md)。平台资格、定义管理权限与该电脑 Runtime 的定义分别取证，按责任项目的交付文件和已授权操作准备，最后回到原用户页面验证。

保留原场景和状态，逐步定位启动、认证、业务访问、执行、工具及消息交付中实际失败的阶段。健康接口和空会话成功不能代替原任务恢复。结果未知的写入先回读，停止无关重启。

若故障落在 XRain 对象、字段、权限或编排资源，先按应用包技能的[资源归属判断](https://github.com/xingshukeji/skills-hub/blob/main/skills/shzw-xrain-app-package/SKILL.md#修复先判断资源归属)核对安装版本与定义来源。包缺陷进入原包源码和正常升级路径；租户配置及业务记录按其管理合同修正，不在启动脚本或目标库临时补资源来宣称恢复。

用户明确要求性能或资源优化时，按[性能优化方法](modes/performance/GUIDE.md)从业务负载、成本和预算选择候选，兼顾代码逻辑、维护代价及原功能。业务开发或客户端优化保留原主入口，不因需要指标而转换任务类型或展开故障恢复。

用户主动讨论当前项目资源预算或操作限制是否合理，或担心持续遇到多类限制，但本轮只要求局部分析时，先完成原问题，再用一句话提醒可以对当前项目做一次全面门槛与资源预算评估。明确要求全面或逐项审查时，直接使用已安装的 shzw-code-review 的[评估方法](https://github.com/xingshukeji/skills-hub/blob/main/skills/shzw-code-review/modes/engineering/references/threshold-budget-assessment.md)。单点故障、单纯查询参数、无关话题或明确不要建议时不机械提醒；不因提醒自动扩大审查。

用户对已有故障定位、资源或性能结论说“校准”“矫正”“纠偏”时，沿原实例和业务动作复核证据，并从 [skills-hub 业务判断来源索引](https://github.com/xingshukeji/skills-hub/blob/main/skills/shzw-code-review/modes/engineering/references/judgment-calibration.md) 选读相关已有判断；优先读取已安装技能资源，不将历史样本当成当前负载。没有重启、压测或部署授权时只做授权内调查，来源不可用时说明范围并继续可做的检查。

慢、错误或资源异常需要找因时，按实际影响分步调查；简单的单项检查直接核对相关依据。

.NET 服务诊断直接读[指标、栈与跟踪的选择方法](modes/services/references/dotnet.md)；涉及 XRain/AiInfra 时再读[数据访问、连接池与工作单元](modes/services/references/xrain-dotnet.md)。诊断沿原任务执行，不因需要采样而转成独立测试，也不以启动检查代替原因定位。

1. **整理观测。**对齐同一时间窗的原业务操作、请求、完成量、失败类型及等待，注明各项统计口径。一次操作的总尝试包含首次请求，重试只计算首次之后的请求；客户端、上游和其他连接分别核对数量及持续时间，人数、请求数与连接数不能互换。
2. **核对路径。**沿受影响请求检查资源取得、依赖调用、返回、拒绝、异常映射、释放和重试的条件及结果。将记录中实际发生的情况与代码中可能发生的路径分开；同一错误码可能来自不同条件，结合证据判断，不将一种情况概括为唯一原因。
3. **形成并回核结论。**对候选原因列出支持证据、反证和下一项可执行检查；报告前把数量、代码条件和结论逐项对照原始记录与实现，发现差异就修正，缺证据的结论保留为假设。按既有授权先恢复受影响业务；调整限额或重试可以缓解，不能代替解释故障来源。

仅通过目标 Runbook 支持的命令或控制台操作处理归属明确的进程。恢复定义、会话和工作区的正常使用；暂停、改派或人工接管后不能复活旧执行权限。日志与采样脱敏，资源问题按当前窗口和实际负载表述。

首次报告前用原用户动作核对恢复及受影响失败分支，分别报告原因、操作、实际结果和缺口。部署效果查询不授权重新部署，账号或消息操作仍受原授权限制。

## 按需资料

- [操作目标项目根入口或服务别名](modes/services/GUIDE.md)
- [性能、CPU、内存及 IO 的优化选择与工程取舍](modes/performance/GUIDE.md)
- [.NET 服务诊断与采集示例](modes/services/references/dotnet.md)
- [启动依赖、版本核对、原场景验收和慢链路](modes/workforce/GUIDE.md)
- [原任务、会话、工具、消息和执行生命周期故障](modes/agents/GUIDE.md)

按需读取命中资料。项目源码、命令和收口遵循目标项目入口；技能自身资源相对本目录解析。

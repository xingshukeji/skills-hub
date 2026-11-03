# Workforce 及关联项目的判断线索

2026-11-03 从 Workforce 项目职责和实际依赖回溯：XRain/AiInfra 承担平台及数据能力，Harness 承担原生运行，OAuth 承担统一认证，铵帮承担业务模型，应用市场承担分发目录，CI/CD 与 deploy-ops 承担交付和运维，skills-hub 持有方法。kh-anbang、xrain-ontology、旧 DSH Desktop 和 window10GUI 仅沿需求、模型或工具继承关系追溯；不因历史项目相关就恢复其旧入口。

本页是检索入口及审查反例。先结合[通用校准](../../engineering/references/judgment-calibration.md)和[all_in_one 历史](../../engineering/references/project-history-calibration.md)，再进入下表的责任技能。当前业务事实仍查责任项目；历史要求、实际实现、包已发布和目标已生效分别判断。这里不重复客户字段或配置，也不把一次人工走查称为稳定性证明。

## 持续校准与新增对话

本方法只适用于 Workforce 统一工作空间及按当前项目路由、实际依赖确认有关的项目。项目维护者授权检查其本人可访问的相关 ChatGPT 和 Codex 对话，包括活动及归档；其他身份不自动获得此授权。用户纠正本会话时先接续原任务；相关的跨对话证据按下列方法发现和判断。该授权不包含向其他聊天发消息、新建聊天、启动子智能体或修改业务产品。

1. 在方案选择、实施、审查、验证和汇报的关键判断处，比较本次目标、已确认取舍、受影响主体、真实结果与证据。发现可能不一致时，查本页命中的责任方法和相邻反例，在原授权范围内纠正并继续；用户明确要求“校准”时立即复核所指结果。无需关键词，也不因普通动作创建另一轮全量审查。
2. 使用当前环境支持的聊天目录及正文工具，分别检查 ChatGPT、Codex 的活动与归档；可用 Codex 应用时先用 `list_threads` 和 `read_thread`，按返回的游标分页。按已有检查点发现新增或更新的聊天，并对边界时间重查；活动聊天只采用已经明确确认的决定，不覆盖其进行中的文件。必要时读取原请求、用户选择、后续纠正和附件，区分用户原话、自动转交与助手建议。
3. 先用项目、实际依赖和具体业务对象判断关联。标题、通用技术词或相同产品名只作线索；标题含糊但可能关联时读取判断所需的最少上下文。明确属于个人事务、无关项目或纯通用讨论时停止，不将其偏好、内容或身份信息写入项目技能。一次任务专属的条件保留在该任务，不能推导为所有用户或所有项目的规则。
4. 对确认相关的纠正，区分新需求、用户撤回误报、原要求遗漏、方法缺陷和环境故障。较新决定只替换同一对象、范围中冲突的部分；保留其他范围、尚未决定的问题和合法反例。先核对现行契约、源码和消费者；必要时按项目已授权的技能进化修改 skills-hub 唯一来源，更新完整消费副本，并检查显式校准与主动自查是否都需要相应调整。
5. 在本机 Local 的 `.agent/calibration-scan/workforce.json` 保存最小检查点：版本、来源水位和待重试聊天 ID；不保存聊天正文、标题、凭据或用户画像。每个来源分别记录检查开始时刻，列完活动与归档目录，处理水位后的新增及变化项并重查待重试项。只有目录分页完整且未完成项已明确列入待重试，才将该来源水位推进到本次检查开始时刻；来源分页失败时不推进。重查边界时间与并列记录，去重聊天 ID；检查点缺失时重新枚举。检查本维护聊天时直接使用当前用户上下文，不把自动任务转交文本当成新的用户决定。
6. 更新过的相关或关联不明聊天需要查用户决定及必要前后文；不能只按对话创建时间跳过旧聊天的新编辑。当前不明确、进行中或无法完整读取的内容保留待重试，不因为暂时没有发现纠正就声明已覆盖。检查点只记录处理进度，不证明所有历史都已理解或所有相似情况都会命中。
7. 聊天工具、账户或历史不可用时，说明具体缺口并继续当前可做的工作。检索和当前执行中的自查按本项目任务触发；后台检查如有配置，仅按其实际执行情况报告。检查、目录同步和作者回放不能证明独立模型表现或实时覆盖。

## 已有知识与责任来源

| 当前问题 | 应进入的已有方法与补充判例 |
|---|---|
| 业务概念、关系、字段多建或漏存 | [建模及历史反例](https://github.com/xingshukeji/skills-hub/blob/main/skills/shzw-workforce-business-development/references/modeling.md#从历史纠偏选择建模反例)、[对象自带能力](https://github.com/xingshukeji/skills-hub/blob/main/skills/shzw-workforce-business-development/references/object-foundation.md) |
| 导入覆盖、普通编辑冲突、预检与恢复 | [导入边界](https://github.com/xingshukeji/skills-hub/blob/main/skills/shzw-workforce-business-development/references/data-operations.md#导入与普通更新的校准边界)、[CLI 导入作业](https://github.com/xingshukeji/skills-hub/blob/main/skills/shzw-xrain-cli/references/commands.md) |
| 登录失败、跨租户、角色与应用可用 | [身份与准入判例](https://github.com/xingshukeji/skills-hub/blob/main/skills/shzw-xrain-access/modes/authentication/references/calibration-cases.md)、[应用安装和重复执行](https://github.com/xingshukeji/skills-hub/blob/main/skills/shzw-xrain-app-package/modes/operations/GUIDE.md) |
| AI 员工、Task、定时安排与运行历史 | [任务生命周期](https://github.com/xingshukeji/skills-hub/blob/main/skills/shzw-runtime-operations/modes/agents/references/task-lifecycle.md)、[业务自动化](https://github.com/xingshukeji/skills-hub/blob/main/skills/shzw-workforce-business-development/references/automation.md)、[平台审查入口](platform-review.md) |
| 菜单隐藏、裁剪、独立应用和公共宿主 | [组合与裁剪](https://github.com/xingshukeji/skills-hub/blob/main/skills/shzw-workforce-business-development/modes/composition/GUIDE.md)、[独立应用接入](https://github.com/xingshukeji/skills-hub/blob/main/skills/shzw-workforce-business-development/modes/integration/GUIDE.md) |
| 源码已修但没有生效、启动与更新 | [启动与来源](https://github.com/xingshukeji/skills-hub/blob/main/skills/shzw-runtime-operations/modes/workforce/references/startup.md)、[客户端历史边界](https://github.com/xingshukeji/skills-hub/blob/main/skills/shzw-client-development/modes/application/references/calibration-cases.md)、[流水线证据](https://github.com/xingshukeji/skills-hub/blob/main/skills/shzw-delivery/modes/pipeline/GUIDE.md) |
| 性能门槛、在线规模和资源结论 | [性能与负载校准](https://github.com/xingshukeji/skills-hub/blob/main/skills/shzw-runtime-operations/modes/performance/GUIDE.md#历史校准中的负载与门槛)、[功能回归](https://github.com/xingshukeji/skills-hub/blob/main/skills/shzw-testing/references/functional-regression.md)、[稳定性场景](https://github.com/xingshukeji/skills-hub/blob/main/skills/shzw-testing/modes/stability/references/scenarios.md) |
| 方案过度、方法重复、完整历史与附件 | [方案质疑](https://github.com/xingshukeji/skills-hub/blob/main/skills/shzw-solution/modes/challenge/GUIDE.md)、[历史提取方法](https://github.com/xingshukeji/skills-hub/blob/main/skills/shzw-skill-evolution/references/history-calibration.md)、[行为验证](https://github.com/xingshukeji/skills-hub/blob/main/skills/shzw-skill-evolution/references/behavior-verification.md) |

## 沟通与运行的典型反例

| 用户决定及出处 | 校准时应检查什么 | 不能外推什么 |
|---|---|---|
| 2026-09-04，聊天 `01a06bf9-4533-76c1-8552-b19001927447`：普通人与 AI 员工沟通，人和 AI 员工都可使用智能体；2026-09-14 至 15 的模型讨论 `01a095a8-41b1-74a2-be11-0ff222e78821` 又强调群聊首先是群聊 | 区分稳定人员身份、沟通事实、明确 Task 和原生运行能力；检查咨询是否被强制建任务，群聊是否被不必要的流程控制接管 | AI 员工不等于智能体定义；有会话、回复或运行成功不证明某项 Task 已完成 |
| 2026-09-16，聊天 `01a0a94c-8759-7112-828f-197bac908fbd` 允许聊天瞬时压力下个别消息丢失；现行 Workforce 产品定义明确这是最低保障 | 对照当前恢复、去重和草稿机制，检查已确认、未知及明确失败是否如实表达，并保留用户再次发送的选择 | 不能要求全部消息绝对可靠，也不能为符合最低标准删除有效恢复；业务记录和外部副作用不沿用聊天的最低保障 |
| 2026-09-19 至 20，模型委托 `01a0bbed-7801-75d0-8204-a02edbf85940` 与 Harness 讨论 `01a0be20-f586-7532-9e33-ab616fb83680` 明确消息由工具发表、运行由实际 Runtime 承担 | 沿真实私聊、结构化提及、回复和工具结果追到发表事实；不同 AI 的身份、会话及上下文分别验证 | 最终文本不自动成为 Message；旧 Codex 适配方案不能覆盖后来确定的 Harness 接入，也不因相同姓名合并身份 |
| 2026-10-05，聊天 `01a10ba6-0b6d-7541-bec0-6a3504fd548c` 由成员选择菜单显示；2026-10-15 至 17，`01a13e85-56f8-7563-979f-47dd0e62f5a1`、`01a147c6-e2f3-7921-9a27-cbcb7dbde2aa` 区分公共能力与铵帮业务 | 从当前组合核对隐藏、裁剪、应用准入及数据权限；通用能力可复用，客户业务源码和交付保持实际边界 | 隐藏不等于撤权；独立业务不等于另造一套 Runtime；一个应用也不必只有一个平台资源包 |
| 2026-10-28，window10GUI 聊天 `01a181c9-8d3a-7e30-977b-d9ef10d09875` 将新 DeskPilot 源码和完整 Skill 交付移至 skills-hub | 核对实际调用的是旧工具还是新分发、目标操作系统与真实桌面证据；工具通用能力和站点操作知识分别归位 | 新代码有后端不证明各平台均已验收；旧仓退役条件未满足时不能直接删原安装；历史购物或聊天测试授权不自动延续 |
| 2026-09-20，ChatGPT 聊天 `6aaf7141-62dc-83ea-86af-655939c1f24f` 虽题为“开源协议比较”，用户讨论的是 Workforce 与独立运行时并提出自研；2026-09-23，`6ab38438-1e00-83ea-931c-69f349dc3ae1` 又明确 Workforce 接入基于 DSH 的外部服务，不自研通用运行时 | 按实际接入对象和后续明确决定核对当前 Workforce 产品契约；保留员工身份、上下文和业务交付等未被替换的需求 | 不从聊天标题判定无关，不把旧自研方案当当前 Workforce 目标，也不把该项目的选择扩大为禁止其他独立项目自研 |

全量回溯只证明所记录时间和可访问来源的覆盖。不能读到的消息、仅恢复未查看的图像、外部附件、未做的真实环境或独立模型检验需分别说明；后来产生的新决定仍需按同一对象与范围更新责任来源。

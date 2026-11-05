# Workforce 及关联项目的判断线索

2026-11-03 从 Workforce 项目职责和实际依赖回溯：XRain/AiInfra 承担平台及数据能力，Harness 承担原生运行，OAuth 承担统一认证，铵帮承担业务模型，应用市场承担分发目录，CI/CD 与 deploy-ops 承担交付和运维，skills-hub 持有方法。kh-anbang、xrain-ontology、旧 DSH Desktop 和 window10GUI 仅沿需求、模型或工具继承关系追溯；不因历史项目相关就恢复其旧入口。

本页是检索入口及审查反例。先结合[通用校准](../../engineering/references/judgment-calibration.md)和[all_in_one 历史](../../engineering/references/project-history-calibration.md)，再进入下表的责任技能。当前业务事实仍查责任项目；历史要求、实际实现、包已发布和目标已生效分别判断。这里不重复客户字段或配置，也不把一次人工走查称为稳定性证明。

## 持续校准与新增对话

本方法只适用于 Workforce 统一工作空间及按当前项目路由、实际依赖确认有关的项目。项目维护者授权检查其本人可访问的相关 ChatGPT 和 Codex 对话，包括活动及归档；其他身份不自动获得此授权。该授权不包含向其他聊天发消息、新建聊天、启动子智能体或修改业务产品。

主动纠偏优先于等待用户提醒。2026-11-03，维护者在聊天 `01a1a03c-302c-7f73-9495-a21fa6c0ba6e` 明确确认：加强主动纠偏，持续发现并推进检查点，每次明确要求校准时完成沉淀。以下三类动作分别完成，后台扫描不能代替当前任务自查。

### 在决策前主动纠偏

1. 在选择方案、准备扩大修改、判定缺陷或受阻、接受验证结果及交付前，对照原用户动作、已确认目标和取舍、受影响主体、实际消费者及证据。先寻找可能推翻当前判断的条件，不等结论失败或用户指出后才检索历史。普通局部动作只查相关判断，不展开全量审查。
2. 在声称“能力不存在”“必须新增公共接口”“存在兼容缺陷”或“需用户再次授权”前，查本页命中的专业方法及相邻反例，再查当前类型、已有实现、实际安装版本和原授权。把尚未找到、确实缺失、已存在但未接入分别判断；不能将未查明的事实直接列为缺陷或交给用户决定。
3. 对命中的历史判断，核对同一业务对象、范围、时间与关键差异。沿原入口验证支持证据和反证：例如注册成功仍需核对实际渲染及上下文，删除与停用分别走各自恢复路径，旧版兼容先核对是否上线及真实消费者。当前目标明确时，在原授权内修正结论和执行并继续；用户只要求审查时不改产品。
4. 发生实际纠偏时，在本任务已有结果中简述原判断、改变它的证据、修正动作和剩余边界。只有读了规则、找到相似例子或重跑了原测试，不能报告主动纠偏成功；用户提醒后纠正与提醒前自行发现分别说明。明确、可复用的新判断按下节归位。

### 每次明确要求后的复核与沉淀

1. 用户每次明确说“校准”“矫正”“纠偏”，或以具体事实纠正当前判断时，立即沿上下文恢复所指结果和原授权，执行上面的反证检查。不得只解释机制、润色报告或等后台扫描代办。
2. 将本次结论区分为新需求、撤回误报、原要求遗漏、方法缺陷或环境问题，再核对已有责任来源。有可复用增量时，在同一次交付中更新 skills-hub 的责任方法或判例、必要的直接路由和已授权完整消费副本。沉淀须写出以后何时主动检查、查什么证据及不适用条件；仅增加聊天出处不算方法改进。
3. 旧规则已完整覆盖且只是执行遗漏时，纠正原任务并引用既有判断，不新增同义规则。单次任务条件、未确认意见及个人无关内容不进入共享技能。收口说明“已更新来源”“已有判断适用、无需新增”或“待核及下一项取证”，每种结论给出对应依据，不能用“无需新增”跳过调查。
4. 处理后立即更新该聊天的检查点；只读请求下只报告应沉淀内容，不写文件。尚缺上下文、来源暂不可读或改动归属不清时，将未完成部分保留待重试；不重新索取已确认的同范围授权。单个聊天处理完成不代表来源全量水位可以前移。

### 持续发现与检查点

1. 使用当前环境支持的目录及正文工具，分别检查 ChatGPT、Codex 的活动与归档；可用 Codex 应用时先用 `list_threads` 和 `read_thread`，按返回游标分页。按项目、实际依赖和具体业务对象判断关联；含糊标题需要读取必要正文，个人事务或无关通用讨论停止追踪。检查本维护聊天时直接使用当前用户上下文，不把自动任务转交文本当成新决定。
2. 每次增量检查先固定来源和检查开始时刻，再处理新增、更新和原待重试项。重查边界时间与并列记录，去重聊天 ID。不能按创建时间跳过旧聊天的新消息；发现目录更新时间落后于正文时，使用可访问的正文活动记录补查，无法补齐则保留覆盖缺口。活动聊天中已确认的决定可以吸收，未结束的执行结果不能提前判定，也不覆盖其工作文件。
3. 对相关纠正读取原请求、用户选择、后续纠正及必要附件，再按上节判断和归位。较新决定只替换同一对象及范围中冲突的部分；助手推测、提问和单次条件不成为项目规则。先核对现行契约、源码及消费者，再修唯一责任方法，不复制业务事实或建立另一套任务台账。
4. 在统一入口 Local 的 `.agent/calibration-scan/workforce.json` 保存最小检查点。保留来源 `since`、`pending` 聊天 ID；版本 2 在每个来源内增加按聊天 ID 索引的 `reviewed`，只记录已处理消息标识 `throughMessageId`、处理时间 `checkedAt` 及处理结果 `disposition`。结果限定为 `updated`、`already-covered`、`no-reusable-change`、`pending`。待核原因、下一取证动作和规则出处留在原任务结果或责任方法；检查点不存标题、正文、凭据或用户画像。升级检查点时保留已有水位及待重试项。
5. 单聊复核只更新对应 `reviewed`；有未完成部分时保留 `pending`，已读并处置后才移除，不能仅因聊天归档、暂时无变化或清单过长而清空。完整扫描列完活动与归档目录，且未完成项已列入待重试后，才把该来源 `since` 推进到检查开始时刻；目录分页失败不推进。写入前重读并合并并行进度，保留新增待办，不覆盖他人的进展。缺失检查点时重新枚举，可复用已核实的既有覆盖证据，但不能凭旧汇总虚构处理进度。
6. 来源不可用时说明具体缺口，保留原水位和待重试，继续不受影响的工作。后台检查分别报告已配置、尚未到时、实际执行无变化、已推进及失败；不得为了证明效果强制触发。普通 ChatGPT 能否加载本机技能，与 Codex 能否读取 ChatGPT 历史分别核实。

检查点表示取证和处置进度，不证明全部历史已理解或后续都会命中。目录同步、作者走查和已见案例回放不能证明独立模型表现或实时覆盖；真实后续机会仍需观察。

## 已有知识与责任来源

| 当前问题 | 应进入的已有方法与补充判例 |
|---|---|
| 业务概念、关系、字段多建或漏存 | [建模及历史反例](https://github.com/xingshukeji/skills-hub/blob/main/skills/shzw-workforce-business-development/references/modeling.md#从历史纠偏选择建模反例)、[对象自带能力](https://github.com/xingshukeji/skills-hub/blob/main/skills/shzw-workforce-business-development/references/object-foundation.md) |
| 业务搜索语义、关键词范围与查询条件数量 | [业务查询合同](https://github.com/xingshukeji/skills-hub/blob/main/skills/shzw-workforce-business-development/references/business-api.md)、[功能回归](https://github.com/xingshukeji/skills-hub/blob/main/skills/shzw-testing/references/functional-regression.md) |
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
| 2026-11-05，铵帮车型查询聊天 `01a1a910-1a80-75f0-959d-eab9254319b7` 要求按语义选择相关字段并优先精确匹配；`01a1a9f6-cf03-7681-bc39-ea7ad07ad0d1` 后续撤回每词最多五字段，要求按输入动态选择、单次条件少于 100，并保留产品代码查询 | 按最新要求核对当前获权字段、实际取值、产品代码及平台查询能力；验证超过五个相关字段、拆批后的并集与交集、反例和完整分页 | 每词五字段和本次单次条件预算都不是平台通用规则；自由文本按实际业务语义选择。不能仅靠拆批或一种等价写法的测试认定结果正确，也不能据源码推断线上已生效 |
| 2026-09-20，ChatGPT 聊天 `6aaf7141-62dc-83ea-86af-655939c1f24f` 虽题为“开源协议比较”，用户讨论的是 Workforce 与独立运行时并提出自研；2026-09-23，`6ab38438-1e00-83ea-931c-69f349dc3ae1` 又明确 Workforce 接入基于 DSH 的外部服务，不自研通用运行时 | 按实际接入对象和后续明确决定核对当前 Workforce 产品契约；保留员工身份、上下文和业务交付等未被替换的需求 | 不从聊天标题判定无关，不把旧自研方案当当前 Workforce 目标，也不把该项目的选择扩大为禁止其他独立项目自研 |

全量回溯只证明所记录时间和可访问来源的覆盖。不能读到的消息、仅恢复未查看的图像、外部附件、未做的真实环境或独立模型检验需分别说明；后来产生的新决定仍需按同一对象与范围更新责任来源。

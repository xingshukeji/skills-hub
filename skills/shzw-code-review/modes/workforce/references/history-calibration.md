# Workforce 及关联项目的判断线索

2026-11-03 从 Workforce 项目职责和实际依赖回溯：XRain/AiInfra 承担平台及数据能力，Harness 承担原生运行，OAuth 承担统一认证，铵帮承担业务模型，应用市场承担分发目录，CI/CD 与 deploy-ops 承担交付和运维，skills-hub 持有方法。kh-anbang、xrain-ontology、旧 DSH Desktop 和 window10GUI 仅沿需求、模型或工具继承关系追溯；不因历史项目相关就恢复其旧入口。

本页是检索入口及审查反例。先结合[通用校准](../../engineering/references/judgment-calibration.md)和[all_in_one 历史](../../engineering/references/project-history-calibration.md)，再进入下表的责任技能。当前业务事实仍查责任项目；历史要求、实际实现、包已发布和目标已生效分别判断。这里不重复客户字段或配置，也不把一次人工走查称为稳定性证明。

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

全量回溯只证明所记录时间和可访问来源的覆盖。不能读到的消息、仅恢复未查看的图像、外部附件、未做的真实环境或独立模型检验需分别说明；后来产生的新决定仍需按同一对象与范围更新责任来源。

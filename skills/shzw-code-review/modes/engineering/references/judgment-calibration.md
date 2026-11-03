# 业务判断校准判例

本页是 skills-hub 中相关业务判断的入口和典型判例，供代码审查、方案复核及修复验收主动检索；不是用户画像、待办清单或产品契约。专业方法和使用知识的唯一编写源是 skills-hub，项目或个人安装的同名技能是消费副本；当前产品目标、实现和运行版本仍由责任项目及实际环境核实。下列聊天只用于追溯当时的决定，不能成为唯一知识来源；其他环境不因聊天不可读而阻断审查。

## 如何使用和更新

从当前业务动作、身份、数据状态、变更和失败路径匹配下方技能来源、[项目历史校准](project-history-calibration.md)及判例；再按任务范围检索 skills-hub 其他相关技能的入口、专题与行为案例，不能把索引或最近一次项目聊天当作全部已沉淀判断。优先读取当前环境已安装的完整技能；需要时从目标项目入口定位 skills-hub 唯一来源，或读取下表的来源链接，不假设安装目录旁一定有源码。来源不可用时说明覆盖缺口，并继续可做的检查。

先用相关判断提出可验证的正反例，再沿本次真实入口、消费者和现行规则核对；同时寻找清单以外的遗漏，不等用户指出具体 Bug。对每项区分已确认、已修复、已撤回、不适用和证据不足；已修代码、过期结论或无可达入口不等于当前仍有缺陷。

本轮明确要求优先于旧判断；后续确认只替换同一对象与范围内冲突的部分。比较实际用户消息或选择的时间、对象和范围，不将提问、设想、助手建议或转交指令当成用户确认；不同业务对象的选择可同时成立。用户要求回溯整个项目历史时，枚举可访问的活动与归档会话，读取用户决定及必要上下文，记录不可读取的聊天、附件或图像，不用抽样或标题冒充全量；在已确认的纠正与仍待核对的反常之处之间分开处理。

历史附件的临时路径失效不等于原件丢失。沿已有附件标识，在授权范围内检查原会话附件、原始记录中保留的嵌入内容、可访问的原链接或备份；压缩归档只读解压核验，不改写历史。恢复后核对来源、内容摘要或文件哈希，并实际打开原件；文字转述、OCR 和缩略图不能替代原图观察。记录覆盖的附件集合和仍不可得项，不从一次路径检查推断全部不可恢复，也不承诺覆盖未登记或已删除材料。原件含凭据或业务数据时只留在允许的本地证据目录，技能只吸收必要判断。

同一情形的新证据或用户纠正出现时，先追到 skills-hub 对应专业方法或使用知识的所有者，在其来源修正旧判断；本索引和判例只保留必要的关联、适用条件和出处，不并列维护另一套业务规则。再按现有授权同步受影响的完整消费副本；必要时保留被替代的关键判断及时间，避免旧结论重新生效。产品规则同时归责任项目的契约或设计维护；尚未提交、发布或部署的变化分别标记。本页不能替代产品事实。用户明确只讨论或不改文件时保持只读。不要把每次交互都记入本页，也不为判例建立独立任务台账。

Workforce 及其实际关联项目采用[持续校准与新增对话](../../workforce/references/history-calibration.md#持续校准与新增对话)：主动反证先于结论和用户提醒；每次明确纠偏完成复核、责任来源处置及检查点更新。该项目授权不向其他工作空间或身份扩散。

## skills-hub 中已沉淀的相关判断

这些是本次追溯到的实际来源和下一步入口，不是封闭目录；按当前任务继续检索相关技能，不因多个链接启动多套完整流程。链接指向 skills-hub 来源，本机安装时可先读相同技能中的相对资源。

| 判断主题 | skills-hub 责任来源 | 已有判断和本次使用 |
|---|---|---|
| 已有审查的复核、误报与遗漏 | [审查入口](../../../SKILL.md)、[工程方法](../GUIDE.md)、[反复缺陷](recurring-defects.md)、[工程正反例](behavior-cases.md) | 沿真实入口、消费者与相邻反例分别确认缺陷、证据缺口及必要修复，不凭数量、历史结论或代码形态定性。 |
| XRain 身份、状态、共享和业务恢复 | [XRain 审查](../../xrain/GUIDE.md)、[Workforce 审查](../../workforce/GUIDE.md)、[平台业务判例](../../workforce/references/behavior-cases.md)、[业务授权](https://github.com/xingshukeji/skills-hub/blob/main/skills/shzw-workforce-business-development/references/authorization.md) | 核对实际用户、租户、字段及记录范围，追保存、读取、失败恢复和替身边界；资源包与运维职责分别判断。 |
| 页面切换、迟到结果与可见体验 | [前端审查](../../frontend/GUIDE.md)、[前端正反例](../../frontend/references/behavior-cases.md)、[功能回归](https://github.com/xingshukeji/skills-hub/blob/main/skills/shzw-testing/references/functional-regression.md) | 对可达操作同时核对当前选择、显示与保存对象；截图只能证明可见事实，必要时补操作或状态证据。 |
| 方案必要性、长锁和维护复杂度 | [方案入口](https://github.com/xingshukeji/skills-hub/blob/main/skills/shzw-solution/SKILL.md)、[方案质疑](https://github.com/xingshukeji/skills-hub/blob/main/skills/shzw-solution/modes/challenge/GUIDE.md) | 对齐用户目标后判断新增锁、状态和维护协议是否必要；比较原能力及可行替代，同时保留真实一致性保障。 |
| 修复回归、性能和资源判断 | [功能回归与性能验证](https://github.com/xingshukeji/skills-hub/blob/main/skills/shzw-testing/references/functional-regression.md)、[稳定性场景](https://github.com/xingshukeji/skills-hub/blob/main/skills/shzw-testing/modes/stability/references/scenarios.md)、[性能方法](https://github.com/xingshukeji/skills-hub/blob/main/skills/shzw-runtime-operations/modes/performance/GUIDE.md) | 先保原功能和合法相邻行为，再比较有效完成量及可比资源；已接受结果、未测负载和生产容量分别判断。 |
| 锁、连接池和事务资源 | [工程审查维度](review-map.md)、[XRain 数据访问诊断](https://github.com/xingshukeji/skills-hub/blob/main/skills/shzw-runtime-operations/modes/services/references/xrain-dotnet.md)、[AiInfra 性能方法](https://github.com/xingshukeji/skills-hub/blob/main/skills/shzw-aiinfra-development/modes/performance/GUIDE.md) | 区分锁冲突、连接耗尽与队列等待，沿实际持有、后续申请和释放路径取证，不以极端样本推定线上频率。 |
| 个人邮箱、会话身份与所有者 | [个人邮箱](https://github.com/xingshukeji/skills-hub/blob/main/skills/shzw-workforce-business-development/references/personal-email.md)、[CLI 邮箱](https://github.com/xingshukeji/skills-hub/blob/main/skills/shzw-xrain-cli/references/files-delivery.md)、[平台 PRD 判例](https://github.com/xingshukeji/skills-hub/blob/main/skills/shzw-prd/references/platform-examples.md) | 区分普通租户会话、代理会话和成员类型；按当前主体与账户范围核验，不凭名称创造真人限制。 |
| 自动化、旧安排与不同重试边界 | [业务自动化](https://github.com/xingshukeji/skills-hub/blob/main/skills/shzw-workforce-business-development/references/automation.md)、[CLI 编排与 Routine](https://github.com/xingshukeji/skills-hub/blob/main/skills/shzw-xrain-cli/references/workflows.md)、[平台 PRD 判例](https://github.com/xingshukeji/skills-hub/blob/main/skills/shzw-prd/references/platform-examples.md) | 分别核对普通 Routine、Trigger 和 Workforce 安排；先确认上线与存量，按目标版本、当前活动状态及终态判断重试和兼容。 |
| 导入导出、字段授权和应用包消费 | [业务数据操作](https://github.com/xingshukeji/skills-hub/blob/main/skills/shzw-workforce-business-development/references/data-operations.md)、[CLI 导入作业](https://github.com/xingshukeji/skills-hub/blob/main/skills/shzw-xrain-cli/references/commands.md)、[CLI 文件与导出](https://github.com/xingshukeji/skills-hub/blob/main/skills/shzw-xrain-cli/references/files-delivery.md)、[应用包技能](https://github.com/xingshukeji/skills-hub/blob/main/skills/shzw-xrain-app-package/SKILL.md) | 追原文件、授权、结果、失败与恢复；区分原子导入和可恢复作业、实际发布版本与候选，以及平台、包内容和租户正常配置。 |
| 方法纠偏和消费副本更新 | [技能诊断与进化](https://github.com/xingshukeji/skills-hub/blob/main/skills/shzw-skill-evolution/SKILL.md)、[工作空间维护](https://github.com/xingshukeji/skills-hub/blob/main/skills/shzw-workspace-maintenance/SKILL.md) | 先判断原方法、实际执行和环境，修 skills-hub 唯一来源及直接消费者；产品、运行及授权规则仍归各自所有者。 |

## 已还原的典型判例

下表补充当时的具体业务和用户选择，关联的可复用方法先回查上方 skills-hub 来源；这些实例不是全部已沉淀知识，也不替代各责任技能的其他相关案例。

| 业务场景与依据 | 当时的判断及可复用检查 | 不得推广的范围 |
|---|---|---|
| 个人邮箱审查：2026-11-02，聊天 `01a19b89-2f6e-7310-9d2f-9855d6d9c5cf` | AI 称个人邮箱仅允许真人使用；用户明确说没有这个约定，该发现被撤回。检查限制是否真的有产品依据，并继续处理其他已成立问题。 | 不能因此断言所有智能体都拥有任何邮箱的访问权；仍需核对当前身份、授权与范围。 |
| 未上线的 Workforce 旧安排：2026-11-02，聊天 `01a19b88-efff-7730-9c92-9cfe133c4684`；批量查询消费者：2026-11-03，聊天 `01a19ff6-cf7e-7ee2-975d-47ecae284748` | 前者确认旧方案未上线、无需向后兼容；后者在 AI 扩大 404/405 降级后再次明确未上线不做旧版兼容。审查接口回退时先区分服务端未知路由的正确状态和消费者为旧版本保留的替代调用；核对所有实际消费者按当前接口调用，不把“以前有这条分支”当保留理由。 | 不将“无存量”套到已上线服务；删除旧版降级不能隐藏当前接口的认证、授权或方法错误。用户确认目标不证明修复已生效。 |
| 对象切换失败：2026-11-02，聊天 `01a19a0e-c428-7303-9ab3-a41af925f45f` | 从 A 切到 B 时 B 加载失败，页面仍可保存 A；当时定向组件测试复现。检查当前选择、显示内容与保存目标是否一致，并覆盖失败、重试和草稿。 | 不能仅凭出现异步回调就报告缺陷；核实当前入口与版本是否仍可触发。 |
| 导入授权及结果：2026-11-02，聊天 `01a19a0e-c428-7303-9ab3-a41af925f45f` | 当时复现关联记录撤权后明细已隐藏但状态数量仍可反映被撤权数据；正常编辑且仍可读时又出现结果误隐藏。检查状态、数量、筛选、分页与文件是否遵守同一当前授权，同时验证仍有权限的合法读取。 | 不把“不可证明可读”伪装成准确的零；也不将正常业务值变化一律视为权限撤销。具体返回协议以当前合同为准。 |
| 公式跨租户引用与查询来源授权：2026-11-02，聊天 `01a19b89-0fcb-79a1-b089-72772095229c` | 复审发现修改平台公式可能影响其他租户的有效规则；公共查询还可能读取无权访问的用户字段作为条件来源。用户要求修复。检查定义的全部实际引用，以及查询字段、来源字段和公式依赖的权限。 | 当时没有找到公共查询经 XRain HTTP 直接暴露的证据；不能把公共接口缺口直接说成已证实的线上泄露。 |
| 记录导出与筛选：2026-11-02，聊天 `01a19b88-deb4-79e2-b87f-25a89cea6eca` | 审查发现展示值、时间字段、脱敏、维护导出和勾选导出等问题，用户要求修复。对照原业务动作检查数据、当前权限、筛选范围和选中结果是否一致，并覆盖合法显示规则。 | 不能为导出成功放宽授权或丢弃当前筛选；也不把显示专用字段一律视为必须导出的数据。 |
| 可恢复导入的并发失败：2026-11-02，聊天 `01a19b89-0331-7fd2-be85-06893a7929d4` | 用户要求修复后，AI 报告处理了并发失败原因丢失、重复重检丢失缩块限制和等待时间被缩短。检查多个失败交错时最终状态是否保留导致暂停及后续恢复所需的约束。 | 这些是当时的修复结果，不证明当前实现仍有同样问题；先核对当前版本和原反例。 |
| 审查和修复兼顾性能：2026-11-02 至 11-03，聊天 `01a19a0e-c428-7303-9ab3-a41af925f45f`、`01a19c35-2182-72e2-abef-c3000fc0c63e` | 用户先要求保住优化成果，明确功能正确先于性能；之后接受当次导入性能并要求沉淀、审查新问题。沿原功能与授权检查正确性，再以相同输入、并发和环境做适用的对照。 | 当次通过不是其他负载的性能保证；不能为快跳过功能，也不能用一次测试次数代替业务正确性。 |
| 应用长锁与维护：2026-11-02 至 11-03，聊天 `01a1995e-2843-7320-aba3-7bc20ed74aea`、`01a19c35-2182-72e2-abef-c3000fc0c63e` | 用户反对影响持续业务的应用级长锁；不兼容变更可以提前通知并在维护窗口快速升级。后来因在线维护流程涉及多入口、状态和页面，用户要求若不能轻量接入就改用规范的离线与上线操作，AI 停止该复杂候选。检查锁持有期间、连接依赖、业务中断及替代方案的维护成本。 | 不等于删除事务锁、跨库协调或全部一致性保护；较晚的简化决定不能被先前更复杂的方案覆盖。 |
| 共享连接池与容量：2026-11-02 至 11-03，聊天 `01a1995e-2843-7320-aba3-7bc20ed74aea`、`01a19b88-f940-7351-aae3-2e23ed305d9e`、`01a19c35-2182-72e2-abef-c3000fc0c63e` | 两个兼容会话锁在特设容量为 2 的池中可占满连接，后续读取等待。较晚的追问确认当时本机默认上限为 100、2 是实验值，用户据此确认该项不是问题；8 核 16 GB 只是避免测试条件过于极端的示例。不得继续把该实验作为当次已确认缺陷。 | 默认值不是实际环境容量的证明；这个决定不排除其他负载下真实的连接耗尽，也不撤销独立成立的问题。 |
| 偶发延迟与跨租户持续错误：2026-11-02，聊天 `01a19b89-0fcb-79a1-b089-72772095229c` | 用户要求本轮不考虑稀少操作短暂未生效，AI 将相关缓存延迟排除；跨租户公式引用可持续失效仍保留。按影响范围、持续时间和实际消费者区分两者。 | 用户没有设定所有场景适用的 5 分钟时限；不能据此推定授权撤销延迟或数据泄露一律可接受。 |
| 升级后短暂旧逻辑：2026-11-02，聊天 `01a19b88-f940-7351-aae3-2e23ed305d9e` | 用户接受短暂使用旧逻辑，优先只让升级前已开始的请求继续；若成本明显较高，也可让新请求短暂使用旧逻辑。比较一致性、延迟与实现代价。 | 不是无限期使用旧逻辑，也不自动免除当前身份与授权校验。 |
| 智能体中断后的继续：2026-11-02 至 11-03，聊天 `01a19b88-efff-7730-9c92-9cfe133c4684`、`01a19edb-f2f6-7bb1-bd2e-dfc5cde3b6dc` | 用户此前提出指数退避、最多重试 5 次，仍失败则记录失败；最新明确所说的重试是智能体运行中断后的继续。此前 AI 把它解释为普通 Routine 超时后重跑整次业务编排，是扩大范围，不能当成用户决定。 | 不将该选择推广到普通业务编排、外部请求或 Trigger；不要推断智能体已具备何种恢复机制。截至本次纠正，现有 Routine 候选会重跑整个编排，不符合该边界，目标实例是否采用该候选另验。 |
| 异步 Trigger 执行版本：2026-11-03，聊天 `01a19edb-f2f6-7bb1-bd2e-dfc5cde3b6dc` | 事件登记后、实际执行前发布了新版时，用户明确采用执行时的版本；版本切换的短暂边界可接受新旧任一版本。执行时点和版本发布之间不必增加严格同步门禁。 | 这是针对该异步事件的最新目标；截至本次纠正，既有设计与候选仍使用登记时版本，不能说已经实现。不要将此结论扩展到其他版本快照或导入事务。 |
| 结论过早与必要性：2026-11-02 至 11-03，聊天 `01a19b88-f940-7351-aae3-2e23ed305d9e`、`01a19c35-2182-72e2-abef-c3000fc0c63e` | 用户要求再次调查并追问未完成项是否确实需要处理。AI 撤回一项缺少证据的新增持久化失效机制建议；连接池实验随后按上一条被用户确认不作为当次问题。分别确认事实、影响与修复机制的必要性。 | 撤回某个方案不证明相关风险不存在；疑点不足以报告为已复现缺陷。 |

## 用判例校准输出

对匹配项写清本次触发与原判例的相同点、关键差异、现行依据及可达证据；不适用或撤回时说明排除条件，只缩小这些条件覆盖的结论。独立成立的缺陷继续报告，待证项写明最小取证动作。用户允许修复时验证原反例和相邻合法场景；只读校准不擅自修改产品。

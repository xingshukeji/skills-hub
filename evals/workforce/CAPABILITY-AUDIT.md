# Workforce skill 能力边界复核

以下记录保留原实验名称与结果；技能引用固定到本报告对应的历史提交，现行入口见[当前技能目录](../../README.md#skills)。未重算历史指标。

## 2026-10-23 精简与架构校准

保留七个独立入口，删除重复流程、通用提醒和命令全集；入口只保留任务选择、关键规则及按需参考。README 同步缩短。计数比较本次修改前后文件，使用相同 `o200k_base` 编码：

| 范围 | 修改前 tokens | 修改后 tokens | 减少 |
| --- | ---: | ---: | ---: |
| 七个 SKILL.md 合计 | 5,155 | 1,895 | 63.2% |
| 按需参考合计 | 22,590 | 10,721 | 52.5% |
| 全部 skill Markdown | 27,745 | 12,616 | 54.5% |

这是文件内容计数，不是整次会话或特定模型的实测用量。详情、文件摘要及逐项评审保存在[本轮记录](results/simplification.json)。

对照 Workforce、Harness、铵帮、CICD、OAuth、独立市场与低代码平台的 34 个源码/维护文件，修正了以下现行事实：

- Workforce 根入口已是 Node.js 的 scripts/start-development.mjs，开发宿主要求 Node.js 24。检查器从 package.json 解析 Node 入口，增加应用脚本、HTTPS 配置、自定义登记及连接器类型检查；本机实际登记已读回通过。连接器可能仍依赖 Windows PowerShell，不能把根启动器迁移理解成所有连接能力均跨平台。
- 日常研发在本机，按配置连接共享测试依赖并选择已获准租户；V2/V3 入口面向演示，test 作业名不决定环境用途。公共核心作业仅准入 v2-public；新铵帮企业单宿主不能套用旧三服务或已退出的合成预览。
- Jenkins 每次固定 main 来源；EXPECTED_COMMIT 是尖端相等断言，不是历史版本选择器。部署阶段须匹配实际参数与目标策略，历史豁免不能沿用。实际加载配置、公共依赖锁与持久状态独立核对，不以重新初始化消除差异。
- 当前铵帮及已迁移 V2 的后台身份按目标配置复用既有租户管理员；用户登录验证仍使用本人身份。账号规则与存量迁移授权边界保留。
- 应用生命周期与授权的主要接口文件仍与上轮核对摘要一致。保留 revision、原 operation、可编辑配置、集合替换、权限影响及协议成功不等于业务成功等规则。

部分产品说明仍残留旧根 PowerShell 或 .NET CLI 命令；本库以当前入口源码和自带 Node CLI 为准，没有修改那些产品仓库。

验证：`npm run check` **122/122**；七个独立目录通过结构校验和真实 Harness 加载器；一次独立离线回放 **11/11** 经主代理逐项复核。回放实际发现 HTTPS 登记缺项，并生成了恢复请求；该请求在合成状态中被接受且保留租户定制。其他场景正确保留旧拓扑、新权限和来源提交不匹配等阻断。未操作真实账号、发送消息、部署或完成线上浏览器验收。

独立回放后仅展开三处简写 API 路径，脚本和状态语义未变，变更摘要已记录。下文保留前轮研究与实验，涉及旧启动器或旧模拟器的记录不作为当前运行依据。

本轮把首轮 9 个 skill 收敛为 **7 个**。独立划分依据是：可单独委托的用户目标、需要维护的领域对象与状态、不可从通用常识可靠推导的规则、可用执行入口，以及可观察的完成结果。场景数量和脚本数量都不单独构成独立理由。

后续执行优化已发现并修正当前受管策略与旧式合并示例的差异，见下文[执行路径校正](#执行路径校正)。此前状态实验中的 Label/KeepTenant 场景只对当时模拟器成立，不能作为当前产品升级效果证据；原结果保留并明确此限制。

`workforce-verify` 与 `workforce-performance` 的专有知识不足以支撑当前独立入口，已合入 `workforce-runtime` 的验收、测量和定位路径，性能脚本保留。其余四个新增入口补齐了生命周期与恢复契约；原三个入口已有较完整的专用工具或认证流程，继续保留。本轮没有修改六个业务项目、触发真实部署、核验真实账号或装配员工工具权限。

## 每个 skill 为什么可以独立

| Skill / 独立用户目标 | 独有知识与执行支撑 | 完成依据 | 边界与拿掉后的缺口 |
| --- | --- | --- | --- |
| [cicd](https://github.com/xingshukeji/skills-hub/blob/c938552e3366250aafaacf3f6e26eb298c4266dd/skills/cicd/SKILL.md)：把指定源码送过已有流水线并取得本次结果 | Jenkins 作业参数、队列到构建的关联、提交结果未知、指定版本；自带可执行 Jenkins 客户端及回执 | 同一作业/参数/构建的终态、制品与部署证据 | 不承担流水线开发或产品修复。通用“运行构建”不能保证不重发或不跟错构建 |
| [xrain-auth](https://github.com/xingshukeji/skills-hub/blob/c938552e3366250aafaacf3f6e26eb298c4266dd/skills/xrain-auth/SKILL.md)：让原身份通过正确客户端进入原应用 | 中心身份/本地凭据/外部主体/平台成员不同对象；激活与恢复影响；OIDC 类型、回调、scope/audience；管理页和受管接入契约 | 新授权请求完成回跳，用户与租户正确；验证密码时确实经过密码表单 | 登录后的业务授权单独定位。仅给 CLI 指令不能完成中心身份恢复和客户端登记 |
| [xrain-cli](https://github.com/xingshukeji/skills-hub/blob/c938552e3366250aafaacf3f6e26eb298c4266dd/skills/xrain-cli/SKILL.md)：用 CLI 完成受支持的平台操作 | profile 与会话优先级、token 绑定租户、元数据和 CRUD 差异、包完整性、批量部分成功；独立打包客户端 | 命令及远端回读一致，包摘要/发布状态可核对 | 这是专用工具操作 skill。与领域 skill 的关系是执行手段可替换，不是让每个业务任务先加载 CLI |
| [workforce-runtime](https://github.com/xingshukeji/skills-hub/blob/c938552e3366250aafaacf3f6e26eb298c4266dd/skills/workforce-runtime/SKILL.md)：把目标环境恢复到用户能使用并验证结果 | 实际登记入口与路径基准、宿主/浏览器/通道/依赖链、发布版本证据、可见操作计时；启动检查器、性能汇总器、验收场景 | 原入口和原操作恢复；未验证项、失败与性能条件明确 | 不替代确定的授权、安装或任务执行诊断。验收与性能是完成运行目标的专项方法，现阶段合并更合理 |
| [xrain-access-diagnosis](https://github.com/xingshukeji/skills-hub/blob/c938552e3366250aafaacf3f6e26eb298c4266dd/skills/xrain-access-diagnosis/SKILL.md)：让业务访问符合职责，并能解释或调整有效授权 | 成员/准入/角色/权限集/数据范围；执行者与机器人；来源和影响摘要；受管诊断、授权、影响预览接口 | 原用户应允许/应拒绝动作相符，变更来源及影响可追溯 | CLI 能发 grant，但不能替用户判断该不该 grant、该改哪个来源。认证失败归身份流程 |
| [xrain-app-operations](https://github.com/xingshukeji/skills-hub/blob/c938552e3366250aafaacf3f6e26eb298c4266dd/skills/xrain-app-operations/SKILL.md)：维护某租户已发布应用的完整生命周期 | 市场/导入/安装分离；版本、revision、operation；配置归属、绑定、策略迁移；状态恢复表、回执检查器和请求生成器 | 正确安装版本、组件状态与原用户动作一致；退出后的保留项可解释 | 不写应用源码，也不把发布等同安装。其状态机和恢复规则无法用通用部署步骤替代 |
| [workforce-agent-troubleshoot](https://github.com/xingshukeji/skills-hub/blob/c938552e3366250aafaacf3f6e26eb298c4266dd/skills/workforce-agent-troubleshoot/SKILL.md)：恢复原员工/任务执行并核实实际交付 | 员工定义、会话绑定、工具策略、assignment/version、grant 失效、持久序号、模型/工具/业务三类结果；宿主查询入口与历史检查器 | 原任务当前分派与本轮历史、工具结果、业务状态一致；隔离边界仍成立 | 服务健康无法解释旧执行为何无权回写、旧回合为何不算本次完成。模型内容创作和架构设计不在范围 |

独立不意味着每条任务必须同时加载七项。初始故障还不明确时先使用最贴近用户目标的入口，查到明确层再接续；各目录内包含完成本域工作所需资料，不要求安装其他 skill。

交叉问题按实际对象落点区分。例如“发布了没生效”：流水线没部署归 cicd，实例仍是旧镜像归 runtime，市场已上架而租户还用旧安装归 app-operations。“登录不了”：连接拒绝归 runtime，OIDC 客户端拒绝归 auth，登录后业务 403 归 access。“AI 卡住”：等待输入/旧分派/工具失败归 agent-troubleshoot，有明确可见耗时与采样的慢问题由 runtime 测量路径处理。

## 场景覆盖与支撑

下面是 **58 个场景族**，不是 58 个已修复线上故障或 58 项真实环境验收。一个场景族包含同一目标下的正常、失败和恢复分支；没有把不同说法重复计数。每项都有现成资源与结束判据，当前业务服务仍需具备相应管理入口、工具和授权。

### cicd：6 个场景族

主要支撑：[执行入口](https://github.com/xingshukeji/skills-hub/blob/c938552e3366250aafaacf3f6e26eb298c4266dd/skills/cicd/SKILL.md)、[Jenkins 客户端与回执](https://github.com/xingshukeji/skills-hub/blob/c938552e3366250aafaacf3f6e26eb298c4266dd/skills/cicd/references/jenkins.md)。

| 编号 / 用户场景 | 关键处理与结束判据 |
| --- | --- |
| C01 目标作业或参数不清楚 | 查询真实目录、作业及参数，把已知项目/环境映射到可执行入口；只交回查不到的必要决定 |
| C02 检查、构建、完整发布 | 选择本次目标所需阶段参数，串联阶段只触发一次；不能沿用 check-only 默认值后宣称部署 |
| C03 发布指定新源码 | 核对作业支持的版本入口、来源提交和产物；固定旧源码则明确缺口 |
| C04 排队到运行再到终态 | 原 queue ID/构建号连续关联，保留确切链接与结果 |
| C05 提交超时、断线或回执不完整 | 查询原队列/构建，未知结果不重发；队列过期仍按原 ID 恢复关联 |
| C06 构建失败、取消或构建成功但未部署 | 解释失败阶段和实际覆盖，不把查询成功、构建 SUCCESS 等同业务可用 |

### xrain-auth：7 个场景族

主要支撑：[固定身份](https://github.com/xingshukeji/skills-hub/blob/c938552e3366250aafaacf3f6e26eb298c4266dd/skills/xrain-auth/references/accounts.md)、[客户端接入](https://github.com/xingshukeji/skills-hub/blob/c938552e3366250aafaacf3f6e26eb298c4266dd/skills/xrain-auth/references/clients.md)、[首次接入](https://github.com/xingshukeji/skills-hub/blob/c938552e3366250aafaacf3f6e26eb298c4266dd/skills/xrain-auth/references/platform-access.md)。

| 编号 / 用户场景 | 关键处理与结束判据 |
| --- | --- |
| A01 已有固定身份直接登录 | 复用原用户和原应用；不先取得无关管理员会话 |
| A02 缺身份或待激活 | 依据生效账号规则查重，保持既有外部主体；完成一次受管创建/激活及原应用回跳 |
| A03 锁定、停用、凭据或验证器丢失 | 按状态与已有授权恢复同一身份；明确撤销会话/验证器的真实影响 |
| A04 client_id 被拒绝或客户端未登记 | 核对实际 issuer、clientId、类型与启用状态；修复后用新授权请求验证 |
| A05 回调、scope、audience 或网页入口不匹配 | 保留其他在用配置，使用真实公开入口和正确客户端契约；不改密码处理接入错误 |
| A06 中心登录成功但目标租户/应用进不去 | 保持 issuer/sub，区分首次建档、目标成员和准入；原用户进入正确租户 |
| A07 验证密码或排除旧会话免登 | 正常退出并经过密码表单，证明的是本次凭据；创建、认证、准入分别报告 |

### xrain-cli：7 个场景族

主要支撑：[配置与认证](https://github.com/xingshukeji/skills-hub/blob/c938552e3366250aafaacf3f6e26eb298c4266dd/skills/xrain-cli/references/configuration.md)、[命令参考](https://github.com/xingshukeji/skills-hub/blob/c938552e3366250aafaacf3f6e26eb298c4266dd/skills/xrain-cli/references/commands.md)、自带独立可执行客户端。

| 编号 / 用户场景 | 关键处理与结束判据 |
| --- | --- |
| L01 多 profile/服务器/租户目标 | 查实际解析来源，避免环境覆盖和默认地址串用；token 绑定租户保持一致 |
| L02 浏览器会话、API Token 和回调故障 | 区分认证方式被拒绝、本地过期和远端拒绝；管理接口明确选 session，回调确能到 CLI 主机 |
| L03 元数据发现与实体能力 | 查真实字段及 Runtime 支持；目录可见不等于能 CRUD |
| L04 查询、筛选、分页及受控写入 | 使用真实字段和作用范围执行，回读结果；不将空列表或 200 作为全部验证 |
| L05 平台用户、角色和权限集操作 | ensure 复用原身份，区分创建对象和绑定授权；不是中心建号 |
| L06 服务端构建、完整性与两类市场发布 | build 一次完成构建校验，输出不覆盖，平台/独立市场会话分离，回读发布版本 |
| L07 批量部分成功与不确定发布 | 读取 failedIndex/已执行结果；从必要步骤恢复，未知发布先查 status |

### workforce-runtime：8 个场景族

主要支撑：[启动与连接](https://github.com/xingshukeji/skills-hub/blob/c938552e3366250aafaacf3f6e26eb298c4266dd/skills/workforce-runtime/references/startup.md)、[版本证据](https://github.com/xingshukeji/skills-hub/blob/c938552e3366250aafaacf3f6e26eb298c4266dd/skills/workforce-runtime/references/release.md)、[验收](https://github.com/xingshukeji/skills-hub/blob/c938552e3366250aafaacf3f6e26eb298c4266dd/skills/workforce-runtime/references/acceptance.md)、[测量与定位](https://github.com/xingshukeji/skills-hub/blob/c938552e3366250aafaacf3f6e26eb298c4266dd/skills/workforce-runtime/references/measurement.md)。

| 编号 / 用户场景 | 关键处理与结束判据 |
| --- | --- |
| R01 新机器接入和入口登记 | 检查器按正确基准解析配置，区分宿主与浏览器入口；缺失受管文件明确列出 |
| R02 默认启动、重启与端口冲突 | 复用统一入口和本人进程；确认归属后处理，保留会话/定义/工作区 |
| R03 通道、代理、TLS 与重连 | 沿实际上游定位第一个失败环节；网络切换后恢复本机连接，不默认重启共享依赖 |
| R04 服务就绪但依赖或业务失败 | 区分 ready、认证、平台、Runtime、模型与具体请求，原操作复测通过才结束 |
| R05 部署后旧效果或环境差异 | 对齐源码、构建、产物、实际实例、浏览器资源和装配配置 |
| R06 间歇故障和运行资源问题 | 失败时段与正常对照，核实进程/磁盘/连接；只清理获准产物，不能重置业务状态 |
| R07 全功能或修复后浏览器验收 | 从实际装配建立范围，验证持久结果、刷新与相关角色边界；未执行单列 |
| R08 页面、登录、会话或交付慢 | 真实交互计时，区分前后台/冷热/失败及请求、渲染、模型、工具；同条件复测 |

### xrain-access-diagnosis：9 个场景族

主要支撑：[权限定位](https://github.com/xingshukeji/skills-hub/blob/c938552e3366250aafaacf3f6e26eb298c4266dd/skills/xrain-access-diagnosis/references/access.md)、[授权来源与变更](https://github.com/xingshukeji/skills-hub/blob/c938552e3366250aafaacf3f6e26eb298c4266dd/skills/xrain-access-diagnosis/references/authorization.md)、[执行与消息能力](https://github.com/xingshukeji/skills-hub/blob/c938552e3366250aafaacf3f6e26eb298c4266dd/skills/xrain-access-diagnosis/references/execution.md)。

| 编号 / 用户场景 | 关键处理与结束判据 |
| --- | --- |
| P01 管理接口 401/认证方式不允许 | API Token 与浏览器会话分开；正确认证后再判断业务授权 |
| P02 新用户看不到应用或准入拒绝 | 主体、成员、enabled、发布范围与本人 admission 逐层定位 |
| P03 角色在却仍无权限 | 检查 active/muted、用户/角色/权限集关系及有效来源；不只看角色名 |
| P04 对象、字段、记录范围或空列表 | 范围内/外与可写/只读对照；正确拒绝不通过授管理员消除 |
| P05 自动化执行缺能力 | 原固定执行身份、readiness、capabilityChecks、grant directory 和 unverifiedScopes 分开处理 |
| P06 机器人未建立、不能代发或能力未登记 | 机器人、实际执行者和发送能力分别判断；无发送授权只诊断 |
| P07 撤权、收缩或删除授权对象 | 预览 sources/digest，明确保留或移除来源，复测准入与 API；其他有效来源仍须解释 |
| P08 替换集合与并发冲突 | 重读后合并保留无关成员/部门/关系，用当前 revision/影响摘要写入 |
| P09 新安装/新用户反复缺同样权限 | 区分登记与绑定缺口，修初始化后验证下一次受控接入，避免只给本次临时加权 |

### xrain-app-operations：12 个场景族

主要支撑：[受管操作与恢复](https://github.com/xingshukeji/skills-hub/blob/c938552e3366250aafaacf3f6e26eb298c4266dd/skills/xrain-app-operations/references/operations.md)、[维护与退出](https://github.com/xingshukeji/skills-hub/blob/c938552e3366250aafaacf3f6e26eb298c4266dd/skills/xrain-app-operations/references/lifecycle.md)、[回执检查器](https://github.com/xingshukeji/skills-hub/blob/c938552e3366250aafaacf3f6e26eb298c4266dd/skills/xrain-app-operations/references/receipt.md)。

| 编号 / 用户场景 | 关键处理与结束判据 |
| --- | --- |
| I01 找包、版本不可见或目录加载失败 | 市场来源、上架、能力、namespace/ID/摘要与 unavailable 分开判断 |
| I02 市场已发布但平台未导入 | 只导入目标版本，核对平台版本与市场来源；不以市场会话执行租户安装 |
| I03 首装缺依赖、资源或租户绑定 | 从受管选择器选真实资源，按 requiredBindings/confirmations 预检 |
| I04 升级与租户定制冲突 | 解释 base/tenant/package 与配置归属，保留租户配置；只按 editableProperties 修复配置不兼容，不能用通用 KeepTenant/UsePackage 覆盖普通属性 |
| I05 提交超时、重复点击或回执关联不明 | 查原 request/operation/安装历史，不能跟错“最新操作”或另造请求 |
| I06 明确失败后的 retry/重新提交 | 区分可重试与 requiresResubmission；新 retry request ID、返回新 operation、旧 revision 核验 |
| I07 等待解决或执行中断 | Waiting 走 resolve；确认中断的 Running/Finalizing 才 continue；取消状态范围有限 |
| I08 回退可行性和当前版本配置维护 | 历史版本存在不等于允许安装；当前市场拒绝未在发布指针上的旧版。允许的渠道再预检，包回退不等于数据库回滚 |
| I09 隐藏组件恢复 | 当前只支持 Hidden BizListView，检查策略/活动操作/revision，回读 effective 与原入口 |
| I10 旧安装管理策略迁移 | policy preview 的差异、绑定、冲突与影响逐项处理；不是手改策略版本号 |
| I11 明确卸载与保留项 | 受管 DELETE 返回 operation，终态和版本回读；不把卸载描述成全部业务数据删除 |
| I12 安装成功但普通用户不能用 | 区分版本、组件、CurrentActorObjectReadOnly、NotChecked 与原用户实际动作 |

### workforce-agent-troubleshoot：9 个场景族

主要支撑：[检查入口](https://github.com/xingshukeji/skills-hub/blob/c938552e3366250aafaacf3f6e26eb298c4266dd/skills/workforce-agent-troubleshoot/references/diagnosis.md)、[员工与会话](https://github.com/xingshukeji/skills-hub/blob/c938552e3366250aafaacf3f6e26eb298c4266dd/skills/workforce-agent-troubleshoot/references/agent-session.md)、[任务生命周期](https://github.com/xingshukeji/skills-hub/blob/c938552e3366250aafaacf3f6e26eb298c4266dd/skills/workforce-agent-troubleshoot/references/task-lifecycle.md)、[历史检查器](https://github.com/xingshukeji/skills-hub/blob/c938552e3366250aafaacf3f6e26eb298c4266dd/skills/workforce-agent-troubleshoot/references/history.md)。

| 编号 / 用户场景 | 关键处理与结束判据 |
| --- | --- |
| G01 员工不可见、订阅或定义不生效 | 目录、本人可用关系、enabled 与订阅分开检查，原身份可发现/使用 |
| G02 模型请求失败或选择未生效 | 当前模型目录、会话配置与真实请求结果；workspace/preset 不可变需按宿主机制处理 |
| G03 skill 已加载却无工具 | 发现、读取、实际 schema、策略与执行结果逐层区分，不擅自扩大 nativeTools |
| G04 正式任务未启动或不跟进 | 当前分派、handoff/version、execution 与任务回写对应，202 只表示接收 |
| G05 等待本人输入或批准 | 查 pending-actions，交回所需输入；不自行代答或重复启动 |
| G06 流式断线、旧回合和分页历史 | 以本次输入前水位隔离，持久序号补齐，hasMore/unavailable 明确保留 |
| G07 工具超时、重复动作或交付缺失 | 先查原业务标识，区分工具结果、消息存储、任务回写和实际交付 |
| G08 暂停、改派、重新打开或人工接管 | 旧执行失效可能正确；只通过当前任务状态推进，拒绝迟到写入 |
| G09 切换员工、任务、用户或租户后串上下文 | 实际 agent/workspace/source/runtimeKey 对应，保留旧会话并验证相关隔离 |

## 横向条件与能力缺口

这些场景按实际目标选择本机、共享测试、演示或生产入口；本机开发命令不能用于生产。人员身份、管理员、自动化执行者、机器人和 CLI 客户端各有不同契约。进行中、等待、未知、明确失败、成功和取消也不能使用同一种“重试”。这几类条件用于选分支，并不宣称已测试它们的全部组合。

仍不包括：备份/灾备建设、任意服务器管理、压测平台、编写业务应用、模型内容质量评审、全量安全扫描。历史中已有部分诉求，但不能仅凭“运维相关”并入本轮运行 skill。目标服务未提供的恢复或安装能力不会由 skill 自动补出。

## 本轮确实补出的领域细节

- 安装恢复：`resolve` 仅对 WaitingForResolution；`continue` 面向中断的 Running/Finalizing；`retry` 要新请求身份并得到新操作；无法保留原输入时须重新提交。
- 组件恢复：当前仅 Hidden BizListView；不同于删除字段恢复、包回退或数据库回滚。
- 版本回退：带发布者或独立市场的应用不能任意安装旧版；维护当前安装也不能用来绕过发布策略。
- 授权：替换集合需要保留其他成员；缩减有效来源使用 impactDigest/source decisions；`unverified` 与 `missing` 不同。
- 消息：应用机器人不可登录，代发能力属于实际执行者；能力通过仍不证明记录/字段范围通过。
- 任务：execution-access 只提供 assigneeId，不能证明执行 grant 有效；过滤后的 execution-conversation 不直接暴露任意 Runtime 会话 ID。
- 历史：旧 completed 必须按水位排除；工具失败不能被后续 assistant 文本覆盖；缺页、无结果与业务交付分别保留。

以上细节已核对当前六项目实现，并落入独立目录中的资料或工具。新增工具只读本地材料：启动登记检查、安装回执检查、会话历史检查；另保留性能汇总器。不把工具存在当成独立性的充分证明。

首轮的对话取样、六项目来源及范围见[首轮报告](REPORT.md)。本轮新增规则重点核对了低代码平台的 `ApplicationPackageApiEndpoints`、`ManagedApplicationApiEndpoints`、安装 DTO、发布策略和市场来源校验，以及 Workforce 的启动脚本、workbench/tasks 路由和工具装配；[契约指纹](results/capability-contracts.json)记录了 10 个主要文件的项目提交与文件摘要。这些是维护时的依据，技能运行时不依赖其他仓库。

## 第二轮验证（固定快照）

本轮结果见[机器可读记录与逐项评审](results/capability-round/results.json)。行为结论由主代理逐项评审全部回答、计算文件及回读记录；不是人工评审，也没有用关键词命中代替行为评审。

| 验证层 | 结果 | 能证明什么 |
| --- | --- | --- |
| 仓库 `npm run check` | 115/115，零失败 | CLI 制品一致性、独立目录、工具行为和模拟服务回归 |
| Skill 结构检查 | 7/7 | 当前目录及元数据符合格式要求 |
| 真实 Harness 文件系统加载器 | 7/7 独立复制后可发现、加载及读取引用 | 使用 `@deepseek-ai/dsh-skill-filesystem` 0.1.7-rc.2 的目录集成；没有安装到员工或验证真实会话 |
| 全目录无选项场景回放 | 20/20 路由及处理判断符合逐项要求 | 覆盖新目录边界、跨域接续和两份实际性能材料分析 |
| 有 skill 的状态执行组 | 7/7 状态任务，5/5 文件分析任务 | 在给定离线模型及材料中实际完成请求并保留验证边界 |
| 无 skill 的状态执行组 | 6/7 状态任务，5/5 文件分析任务 | 相同任务、原始材料和 API 索引下的对照表现 |

状态执行使用[当时冻结的请求、状态与模拟器](results/capability-round/inputs.json)、[当时逐项要求](results/capability-round/rubric.json)，有/无 skill 各独立执行一次。七项写入任务会留下请求轨迹，校验器重新执行轨迹并核对最终状态，不能仅靠回答“完成了”通过。五项分析包括启动文件、分组性能、旧回合与当前工具失败、串租户回执及工具/会话配置。

当时模拟器中可观察的增量出现在 `l01`：无 skill 组不了解字典键规则，五次绑定提交均被拒绝，最终如实报告升级未完成；有 skill 组从资料取得规则，一次提交完成模拟升级。该项分别产生 17 与 7 次模拟 API 请求，其中拒绝的写入为 5 与 0 次。后续核对实际受管策略发现，该样例还包含不被当前产品接受的普通属性 Label/KeepTenant 和错误的绑定组件归属，**这项差异不能用作当前产品操作正确或实际收益的证据**。其余 11 项两组都满足要求，也不能推出每个 skill 都提升了成功率。

[有 skill 完整输出](results/capability-round/with-skills.json)和[无 skill 完整输出](results/capability-round/without-skills.json)按原输出文件名封装脚本、响应、计算及状态轨迹，保留各文件摘要；[20 项路由回答](results/capability-round/routing-answers.json)单独保存。所有材料均为合成数据，未提交真实对话内容或凭据。

最后核验将回执工具的模糊字段 `installationMatchesTarget` 更名为 `installedVersionMatchesTarget`，明确它只比较版本，不能覆盖租户/操作冲突。固定实验原件保留不改；更名后重放了 6 份回执，除字段名外输出一致，并重新通过全仓检查和 7 个独立目录加载。没有把这次小修伪装成重新执行了整组模型实验。

本轮只有一次配对实验，没有统计可靠性、耗时或普遍质量提升的结论。模拟器是人工维护的有限状态模型，不是实际产品 HTTP 服务；API 索引也不含全部领域语义，两组均不得外查契约。58 个场景族未逐一进行真实服务验收，本轮没有真实账号操作、消息发送、部署、浏览器验收或员工工具装配。首轮的选择题及前向回答保留在[首轮报告](REPORT.md)，不用于替代本轮证据。

复现时先准备新的输出目录，将每组独立交给只可访问本组资料的评估代理，然后校验状态与按冻结要求逐项评审：

```text
npm run eval:capabilities -- prepare .local-validation/capability-next 1
npm run eval:capabilities -- verify .local-validation/capability-next
npm run eval:forward -- --output .local-validation/routing-next --repeats 1
npm run eval:verify -- --output .local-validation/routing-next
npm run check
```

`prepare` 不会自动执行代理；`verify` 只完成结构/轨迹核对，语义评审不能省略。首次探索实验在校正接口方法与版本发布限制后已作废，正式结果只使用 `execution-02` / `routing-02`，未挑选旧实验中的通过项拼接。

## 执行路径校正

后续源代码复核发现，当前 `ApplicationPackageResourceCoordinator.PreflightAsync` 只接受当前管理策略，普通属性的通用 `resolutions` 会被拒绝。`BizListView` 的租户配置由策略保留；失效字段引用等 `$configuration` 冲突应根据 `editableProperties/editorContext` 提交 `configurationChanges`，每项使用 `{present:true,value:...}` 或 `{present:false}`。连接目标 `baseAddress` 属于 `BizConnector`。这比读取枚举名称更能决定实际请求能否成功。[本次契约指纹](results/resolution-contracts.json)保留了四个主要实现文件的摘要。

已修正安装、维护资料及当前模拟场景，并增加[请求生成器](https://github.com/xingshukeji/skills-hub/blob/c938552e3366250aafaacf3f6e26eb298c4266dd/skills/xrain-app-operations/scripts/prepare-resolution.mjs)：复用原操作和当前 revision，检查绑定及可编辑属性，使用当前回执中的确认 token，将已决定的输入写入新的私有文件。它拒绝覆盖文件、未决定的影响、源 revision 变化、错误租户与不支持的旧式冲突；不会替用户选配置或发送请求。具体使用见[回执工具](https://github.com/xingshukeji/skills-hub/blob/c938552e3366250aafaacf3f6e26eb298c4266dd/skills/xrain-app-operations/references/receipt.md)。

同时补充历史工具的结果解释：`succeeded` 是工具协议层结果，原结果 `ok:false`、业务拒绝和异步接收仍须单独处理；代理回合 completed 不代表任务完成。

验证工具现在使用每组已核验摘要的冻结模拟器重放轨迹，规则更新不会改变旧实验的语义。旧 `l01` 局限已补入原机器记录，原回答、请求和摘要保留。

本次[结果与逐项评审](results/resolution-round/results.json)由主代理复核全部 24 份状态任务回答、两组分析文件及请求轨迹，以及 24 项前向场景回答：

| 当前验证 | 结果 |
| --- | --- |
| `npm run check` | 120/120，零失败；包括新请求生成器的正确请求、缺少选择、权限影响、过期/串租户输入、独立复制、私有输出和拒绝覆盖测试 |
| 独立目录与真实 Harness 文件加载器 | 7/7 |
| 修正后的状态任务 | 有 skill 与无 skill 两组均 7/7；另五项文件分析均满足要求 |
| 前向场景 | 24/24 路由和处理判断符合要求，包括四个新增场景 |
| 实际请求准备 | 独立代理生成 prepared-request.json，方法、revision、连接器键和字段配置通过检查；原始正文留在私有实验目录 |

本次 `l01` 中，有 skill 组使用请求生成器，零次写入被拒；无 skill 组经过五次绑定拒绝及一次不可编辑属性拒绝后完成同一目标。两组最终都成功，不能宣称成功率提升；所有七项任务总 API 请求为 42 与 40 次，有 skill 组在其他任务做了更多回读，因此也不能据此宣称总调用、token 或耗时下降。此次支持的具体价值是减少该项操作的无效写入尝试。

新场景另验证了：工具 succeeded 但原结果 ok:false 时不报任务完成；旧式普通属性合并被拒后转配置修复；只准备私有请求而不提交；已有绑定/配置决定不重复确认，但新增权限影响不能自动确认。公开的[状态与分析证据摘录](results/resolution-round/evidence.json)、[有 skill 回答](results/resolution-round/execution-with-skills.json)、[无 skill 回答](results/resolution-round/execution-without-skills.json)、[前向回答](results/resolution-round/forward-answers.json)和[冻结输入](results/resolution-round/inputs.json)均为合成材料。

模型回放后，入口仅进一步澄清按当前动作接续：原操作恢复、组件恢复、配置维护和卸载不先重走市场选版；同轮新鲜回执可复用，变化后才刷新相关记录。未改脚本或请求结构，未重跑整组模型实验。本次仍为单次离线配对，未进行真实服务、账号、消息、部署、浏览器验收或员工配置变更，也没有逐一验收全部 58 个场景族。

## 常用触发方式

| 想完成什么 | 示例 |
| --- | --- |
| 原流水线执行与跟踪 | “发布这个提交到测试环境”“刚才发布断线了，查原构建” |
| 身份与统一登录 | “激活这个固定用户”“恢复原账号”“原应用回调被拒绝” |
| 专用 CLI 操作 | “用 CLI 查订单”“查这个用户的角色”“构建并发布应用包” |
| 环境使用与运行验收 | “启动开发环境”“上线还是旧效果”“内置浏览器完整验收”“查切换会话为什么慢” |
| 业务访问与授权变更 | “新用户看不到应用”“机器人到底缺什么权限”“撤权后怎么还能读” |
| 租户应用生命周期 | “升级并保留租户定制”“继续上次失败安装”“恢复隐藏视图”“回退这个版本”“卸载并核对保留项” |
| 智能体运行与交付 | “任务为什么没有跟进”“加载 skill 后工具在哪”“人工接管后还在写”“断线后查这次是否真的完成” |

更新已有安装副本时应移除旧 `workforce-verify`、`workforce-performance` 入口并安装新的 `workforce-runtime`；否则宿主仍可能发现重复路由。本轮只调整仓库交付目录，未更改用户本机已安装副本或员工配置。

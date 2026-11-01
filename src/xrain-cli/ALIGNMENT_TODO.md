# XRain CLI 用户功能对齐

核对日期：2026-11-01。范围：当前 Node.js CLI、XRain 平台、Workforce、Runtime 和现有公共子应用。任务类型为 Development。CLI 由 skills-hub 维护，各产品保留业务规则和状态所有权。

## 判断口径

按用户从发现入口、读取与操作、取得回执、保存后重入到失败后继续的任务核对。命令存在只证明可达；源码、CLI 替身、原处理器隔离验证和共享环境实读分别记录。旧 .NET CLI 保持退役。

前轮从各产品当前功能与实际 HTTP 入口反查 CLI，补齐本人租户切换、窄成员目录、Host 成员状态筛选、本人 Token 签发、应用包能力与提交候选、员工关联定义选项、Workforce 助手发现和订阅、单次计划运行及历史分页，并修复独立顾客接待订阅适配。

本次再次按产品功能、输入、回执与恢复检查当前实现。补齐平台和独立邮箱的能力查询；修复集合写入把空、缺项、错位或未确认提交的回执当作成功的问题；顾客接待助手目录不再接受原服务忽略的 pageSize。当前 Workforce 已提供来源消息中的 AI 执行控制及 Task 取消挂载，CLI 对应入口一并复核。

下表同时保留前轮有效证据。前轮应用目录、邮箱 CLI 与真实页面验证仍只证明其原版本、环境和身份范围；本轮不将这些证据扩写成全部功能实测。“实现对齐”表示存在对应业务入口和原语义，隔离测试、原处理器验证及共享环境实测分别标明。

## 用户任务对照

| 用户任务 | 当前 CLI 与原业务结果 | 当前判断和证据范围 |
|---|---|---|
| 连接、统一登录、发现与切换企业、核对身份和应用准入 | profile 与 auth 使用平台登录；switch-tenant 核对同一主体后取得目标租户会话。可另存连接并保留原登录，跨目标清除无效 Runtime 和应用配置。Workforce、邮箱和接待继续使用本人会话及实际应用。 | 已补本人切换。定向验证覆盖原连接、另存连接、不同主体/租户回执、失权、断连及不重放。原生及代理登录回归通过。前轮统一登录及邮箱页面证据保留；真实跨企业操作仍未验证。 |
| 搜索可见成员、管理 Host 租户成员和数据库 | member list/show 使用平台窄目录；security 继续负责获权成员管理；Host member list 支持原 isActive 筛选及完整分页查询，Host 数据源由服务决定。 | 已补窄目录并扩展 Host 原列表。定向验证核对普通成员目录、目标租户、停用筛选及原拒绝，不回退管理员目录。 |
| 管理组织、角色、权限、API Token 和审计 | security 使用原组织、角色、权限集、目录、Token 和审计接口。auth api-token create 只为已保存的当前身份签发，保护文件绑定平台、租户与作用域。 | 组织及授权沿现有定向验证；本人签发补验租户与 Host、文件保护、不覆盖、未知结果和身份参数拒绝。原接口没有客户端请求键，回执丢失不再次签发。 |
| 编写业务编排、函数、HTTP 集成及自动化 | orchestration/function/http/routine 使用原请求、执行结果和已有调度；HTTP 原始输出保留响应和文件。 | 当前原接口及 DTO 核对，既有成功/失败、原回执、未知结果、文本/二进制输出及不重放验证保留。CLI 不新增业务执行引擎。 |
| 配置变量、本人及租户地区时间、存储和投递渠道 | variable、regional、time、storage、email、feishu、sms 复用各自作用域、设置与投递服务。连接检查与实际投递沿原结果判断。 | 对照原接口核对作用域、查询及请求；沿既有定向验证保留权限拒绝、未知结果和原业务状态。本轮未向真实接收人投递。 |
| 设计对象、字段、视图、选项和记录类型，删除后恢复 | metadata 保留 ETag、创建请求键、删除影响令牌及失败部署恢复；请求键按原 Header 传递，不借用记录创建的 160 字符规则或额外 Header 长度上限。recycle 使用平台原回收站。 | 已修复元数据误拒。对象创建、字段创建和失败部署修正均验证较长原键、服务拒绝及回执丢失；记录创建的原限制保留。未在共享租户修改结构。 |
| 查询与写入记录、选用视图、分享、转移负责人和查看历史 | data 与 metadata view 复用平台查询、记录、共享及历史；单记录创建可用原 requestKey 回查，集合核对原输入数量、索引、记录与提交状态。回执缺失、错位、超大或尚未确认提交均保留 outcome_unknown。 | 已修复集合回执误报；隔离及完整 Skill 验证未知结果只写一次并停止 batch，原子数组、空删除回执和 committed 的逐项失败保留原义。前轮大回执及 keyed creation 证据保留；未写共享业务数据。 |
| 取模板、检查完整文件、分块导入、暂停恢复、导出文件 | data import capabilities 返回当前能力及不可用原因；template 独立调用原模板服务，不套用分块资格、上传文件或选项大小限制；作业仍核对当前资格和计划修订，保留已提交进度。 | 已修复模板误拒。隔离验证覆盖分块不可用但模板允许、原服务拒绝、分块选项限制保留、断流和文件不覆盖；共享平台能力结果与原接口一致，模板实际下载成功。真实导入提交未执行。 |
| 上传下载文件、附件和原始响应 | file、Workforce attachment 及原始输出流式传递；服务决定业务限额，客户端保留长度、摘要、清单解码、临时文件及不覆盖保护。 | 实现对齐；本轮沿既有大文件、拒绝、断流、磁盘失败与恢复测试复验，不把本地资源预算当作业务配额。 |
| 找人、单聊群聊、群管理、消息编辑撤回、转发、搜索、草稿和附件 | workforce people/channel/group/message/search/draft/attachment 沿原处理器；来源消息的 AI 执行可查询、停止和处理原待答项；各转发目标独立提交，来源范围和版本不变。 | 复用固定测试人物的真实发送、持久回读及第三人拒绝证据；本次用当前 CLI 再读原私聊、AI 来源执行及已保存回复。群治理与媒体的其他验收仍归原活动。 |
| 应用机器人发通知并查回执 | application-message 使用原执行者凭据和 clientMessageId，区分 accepted、saved、failed 和 unknown；不借成员接口发布。 | 实现对齐；原发布处理器及独立 CLI 消费验证，未向真实群或公告发布。 |
| 建立和交办 Task、改派、状态、挂载、提醒及执行对话 | workforce task 保留原任务，attach/detach 挂载或取消原频道关联；创建、确认、改派或重开后的挂载/AI 接纳失败返回 partial_success，batch 停止并保留失败步骤回执。 | 已修复部分完成误报。原处理器验证 AI 拒绝后原任务恢复且不重复执行；CLI 验证只写一次、停止后续步骤、读取原任务和服务拒绝。accepted 不表示 AI 已完成。 |
| 建立和修改计划、启用暂停、读历史、处理问题和取消运行 | workforce schedule 调用原计划及运行接口，支持原 paged/before 和按 scheduleId/runId 读取单次运行；主体凭据、调度和执行历史由宿主持有。 | 已修复宿主目录与启用检查遗漏应用上下文，以及 CLI 取消请求缺少空 JSON。真实计划保存、启用、到点工具查询、历史与对话回读、暂停及取消均通过；重启保留同一计划和两次运行。其他人物仍不能读或取消该运行，已结束运行返回原 409。 |
| 定义、工具、工作区、订阅和应用选用 | agent definition/tool/workspace/policy/subscription/application 使用原版本、工具目录和资格。employee-options 与 member 使用各自窄读取。workforce agent list/catalog/subscribe/unsubscribe 由宿主连接实际 Runtime。 | 已补窄读取和宿主助手入口。原处理器验证分页、可发现但不可使用项、申请/取消及撤销准入；CLI 保留原字段和拒绝。前轮限额、并发、工具继承与真实邮箱定义选用证据保留。 |
| 与助手对话、续聊、回读工具和终态、提问审批、取消与恢复 | agent chat 与 workforce session 保留原 sessionId/requestId；等待或回读不重发。toolCalls 和 history 保留原 callId 及工具结果 result，包含正文、错误和元数据；凭据脱敏。轮次完成但没有文字仍成功，工具失败单独保留。Ctrl+C 只结束本地观察。 | 真实模型调用销售助手的只读工具，当前 CLI 与 Workforce 均能回读同一 callId 和结果。无业务权限人物的工具返回 CONNECTOR_FORBIDDEN，原会话仍能续聊。真实运行中取消后得到 aborted，同一会话可继续；第三人读取和取消均拒绝。另次独立测试已验证真实提问、明确允许一次与拒绝，以及他人拒绝、同标识重试和迟到答复；各端待批页面仍未完整验证。 |
| 受管单次执行与临时文本 | agent run start/show 按原 runId 查询服务的有界结果；ephemeral 使用原纯文本协议，没有持久会话、工具和历史。 | 与当前服务能力对齐。受管回执丢失没有客户端请求键可恢复，当前服务也无受管 runId 取消接口；CLI 如实保留未知，不另造恢复状态或自动重放。 |
| 回答反馈和语音 | workforce session feedback 与 speech 复用原会话、回答、本人反馈和 speech Remote；语音识别不自动发送。 | 独立测试已完成实际页面与CLI的正负反馈、分类意见、修改撤销、新进程回读及无权会话、非助手回答拒绝；Android原生反馈和前后台恢复已验证。受管服务的已有音频转写及失败后恢复通过。Android录音启动失败，录音中取消和转写草稿不自动发送仍未验证；未下载模型。 |
| 本人功能组合、应用目录、账号绑定和企业管理 | composition 保存本人的选择；applications 返回实际准入和普通浏览器入口，不生成浏览器会话专用地址。导航选择只核对准入。account/enterprise open 返回或打开原确认页面；平台 security/host 管理已有成员和角色。 | 已修复目录及组合选用误拒。原处理器的查询、保存和重入通过；原宿主重载后，独立 CLI 返回完整目录及邮箱普通打开地址，组合包含邮箱路由。实际门户卡片、独立授权回跳、本人邮箱和切回原账号后的内容清理通过。 |
| 独立邮箱：账户、文件夹、搜索、原邮件、AI 和草稿 | mail capabilities/app capabilities 分别读取实际服务的当前限额。app search/read 保留原 reference，assist 仅返回建议。平台和应用的 draft 共享 Saved、internetMessageId 和原账号检查；服务的 email_draft_outcome_unknown 保留未知语义。 | 新增完整 Skill 进程经原 MailServer、原客户端和隔离平台验证能力读取、较大转义正文保存、原 409 停止 batch 及权限拒绝。前轮固定 163 邮箱与 DeepSeek 的实测保留其原环境、身份和版本范围；本次未发送邮件。 |
| 顾客接待：查询、登记、编辑、字段选项、助手订阅和继续原对话 | retail context/customer/options 使用实际对象和字段，conversation 复用原顾客及本人会话；subscribe/unsubscribe 消费原平台个人订阅。 | 已修复独立应用订阅适配缺失，并补取消命令。原应用 HTTP 验证订阅待批、取消、错误应用上下文及撤销准入；CLI 验证未知结果不重放。前轮顾客字段、保存、冲突和关联验证保留。 |
| 应用管理、市场和应用包开发安装 | application 管理治理；app 查询实际能力及提交候选，完成构建、发布、导入、安装、升级及操作恢复；market 按精确版本核验原包。 | 已补能力和候选读取。定向验证租户及 Host 的原结果与拒绝，未引入安装或发布。既有恢复及制品完整性验证保留。 |

## 验证与未验证范围

2026-11-01另次受控SystemTest固定了[真实交互与设备余项计划](../../../xrain-workforce/文档/项目/项目_XRAIN_WORKFORCE/推进中/TEST-20261101-真实交互与设备余项.md)中的候选。当前15380加载的Workforce仍为0.3.19，但源码摘要为`1bf8860f6be66b39c09a49c38e340bd07bd4971857aabfb85797699ccdef0e1b`；Runtime沿用下述0.2.5摘要，CLI为`f24df56c6e3cf15a022bf65b7e73ce9bdb645c73609b5a823ce957ee3ee8a2c1`。与前轮旧包分别记证据，不按相同版本号合并结论。

该独立测试已完成真实原生提问、用户明确决定的工具允许一次与拒绝，并核对原actionRef/sessionId/requestId及终态。他人答复返回404，同答复标识重试被识别，迟到的新答复返回409。实际页面、CLI新进程及Android核对了本人反馈保存、修改、撤销和重入；无权会话及非助手消息提交被拒绝，原反馈保持不变。受管语音服务对已有合成音频真实转写成功，且无效音频失败后可以恢复。当前15380也已验证计划发现、启用及恢复原暂停状态，历史未新增。本轮没有重启共享宿主、安装模型或修改产品源码。

Android现有APK的录音启动失败，日志要求`MODIFY_AUDIO_SETTINGS`和`RECORD_AUDIO`，实际APK缺少前者；其余输入保护、原生返回和前后台草稿恢复已验证，最终草稿清空、反馈撤销、账号退出、模拟器及本轮转发清理。Electron启动被自动审批审查阻断，Windows无可用录音输入且没有iOS设备。录音中取消、成功识别进入草稿后不自动发送及各端待批页面仍保留缺口。非秘密证据位于Workforce忽略目录`.agent/tmp/systemtest-remaining-20261101`，详细标识、设备摘要、责任及恢复条件由原测试计划持有。

以下历史开发证据保留其当时版本和环境范围。

2026-11-01 的增量实测复用集中测试平台、铵帮开发租户 `00k01a1551dfeae60vvl` 和应用 `app01a1553cc4ca323zv`。执行人为固定 `test`，拒绝分支使用固定周安博；沿原台账和登录连接核对身份，没有新增账号、补权或自动审批。模型使用现有 DeepSeek 配置，工具为原 `anbang-sales` 的 `service_quotationOptions`，只查询合成的不匹配关键词，没有写业务记录或发送业务通知。

本机 `15380` 的既有 Workforce 包为 `0.3.19`，源码摘要 `0669ec344c13a00978f40bb7ba3d34d93f7889c9dfa19cec47fb281c2cc82b4a`；Runtime 为 `0.2.5`，源码摘要 `8dd0bafa985e627462def160e6abb8242c0ffa5108f4a97ca4ae40af7b9587f4`。计划修复在 `15384` 的当前 Workforce 独立服务入口验证，使用独立本机状态和同一真实平台、Runtime。正常执行保留真实工具结果；另一次明确取消的运行记录为 `Failed / runtime.aborted`。两次运行、原对话和暂停状态经服务正常重启后保持，读取没有触发第三次执行。该证据不表示共享宿主已重载计划修复。

本次复现并修复无参数取消命令的 HTTP 400；当前 CLI 构建摘要为 `053a793de620768e36cd34eb8f1c543d07122b553d6ba5dc82404f0366f564e2`。定向检查及完整 Skill 独立消费覆盖正常取消、403、409、回执丢失后停止 batch 和原资源回读。真实会话与计划取消均在观察到 Running 后执行，没有替身参与上述实际模型与工具链。原发送证据位于 Workforce 忽略目录 `.agent/tmp/workforce-chat-full-20261101`，本次非秘密断言位于 skills-hub 忽略目录 `.local-validation/cli-functional-recheck/live-*.json`。

平台编译差异来自旧 AiInfra 包与当前源码不一致。沿 AiInfra 原候选验证入口从源码构建 `0.0.180-runtime-batch.4`，核对隔离 feed、实际包缓存和消费 assets；XRain 与生成脚手架构建通过。原 Local 工作目录恢复同源候选依赖后，原邮箱和集合权限契约 14 项通过。没有复制公共类型或改写业务实现，也没有发布包。候选与正式缓存的同版本摘要不同，后续验证必须保留准确来源，不能只按版本号认定为相同制品。

候选入口已将 NuGet 锁文件隔离到本轮临时目录。修复后的入口完成当前源码消费验证，原 14 项契约及 2 项导出检查通过，35 份正式锁文件在验证前后未变。CLI 的 431 项检查通过；Workforce 独立交付候选的 27 项计划相关检查、45 项文档检查器测试及文档检查通过。共享工作目录中其他活动的文档登记失败单独保留，不计入本次候选结果。

再次核对的新增证据见[邮箱能力](../../tests/cli-mail-capabilities.test.mjs)、[集合回执](../../tests/cli-collection-receipts.test.mjs)与[顾客助手目录](../../tests/user-functions.test.mjs)。完整 Skill 的原邮箱服务消费见[草稿生命周期](../../../xrain-workforce/applications/mail/tests/personal-mail-draft-lifecycle.test.mjs)：CLI 在独立目录和新进程登录，读取当前能力后，使用相同身份保存一份合成草稿；未知结果不继续第二次写入。平台、认证与邮箱提供方均为隔离替身，不能作为共享部署或真实 IMAP 的新证据。

本轮新增 CLI 证据见[租户切换](../../tests/cli-tenant-switch.test.mjs)与[用户入口](../../tests/cli-user-entrypoints.test.mjs)。宿主助手、计划查询及顾客接待订阅的原处理器证据见[原 HTTP 入口](../../../xrain-workforce/tests/cli-user-entrypoints.test.mjs)。这些测试使用隔离状态和上游替身，不代表共享部署已经更新。完整 Skill 使用独立目录和新 CLI 进程验证，构建物由源码生成。

CLI 定向及完整 Skill 消费测试见 [导入](../../tests/data-import.test.mjs)、[Task 回执](../../tests/workforce-cli.test.mjs)、[用户功能](../../tests/user-functions.test.mjs)和[独立消费](../../tests/cli-alignment-bundle.test.mjs)。顾客原入口对照见 [独立应用测试](../../../xrain-workforce/applications/retail-assistant/tests/server.test.mjs)，Task 的保存和重入见 [原回执测试](../../../xrain-workforce/tests/task-write-receipts.test.mjs)。

前轮证据见[工具回执与重入](../../tests/cli-tool-receipts.test.mjs)、[元数据请求键](../../tests/metadata-operations.test.mjs)及[记录创建恢复](../../tests/cli-record-creation.test.mjs)。CLI 隔离验证覆盖原工作台的 tool-role 和嵌套 tool-result 格式，保留正文、错误及元数据。历史查询仍由 Runtime 按原会话授权，不建立另一套历史。

本轮新增证据见[草稿结果与查询恢复](../../tests/mail-draft-outcome.test.mjs)、[当前定义接口](../../tests/cli-definition-settings.test.mjs)和[独立包定义消费](../../tests/cli-agents-bundle.test.mjs)。草稿的 Saved 回执允许 reference 为空；缺少 internetMessageId、非 Saved 状态或引用了其他账号时，保留原结果为未知。恢复只查询原邮箱的文件夹、草稿搜索和原引用，没有再次保存。定义测试覆盖缺失接口、无效限额、原版本冲突、限额不可用时的启停，以及导入恢复工具继承。

前轮 Workforce 原邮箱 HTTP 处理器与原 MailXRainClient 在隔离上游下，对 CLI 和网页入口返回相同的未知结果、账号冲突和身份拒绝。原 XRain PersonalEmailApiTests 的稳定错误测试也验证了 HTTP 409 的 email_draft_outcome_unknown。该组仍属于组件证据。

本轮真实邮箱复用 deploy-ops 的固定 163 测试邮箱及既有凭据引用，使用当前共享平台和原租户。平台 CLI 与独立邮箱 CLI 各保存一份合成草稿，并在新进程按原引用读回同一中文正文；没有发送邮件。原生 test 成员列不到维护者连接，读取该连接返回 404 email_account_not_found；失效 uidValidity 的回复草稿返回 409 email_reference_stale，原草稿仍可读取。独立应用 ID 改为另一应用时返回 409 cli.context_changed。

独立邮箱已按用户授权登记自己的应用和公开 OIDC 客户端。本机实际页面用既有 workforce-user-20261017 登录，添加本人的固定邮箱连接并完成收发认证；随后读取 CLI 草稿、保存浏览器草稿、统一退出、重新登录并读回完整中文。实例参数和启动由 [邮箱共享测试接入](../../../xrain-workforce/文档/项目/项目_XRAIN_WORKFORCE/运行/RUN-0013-独立邮箱共享测试接入.md)持有；本机证据在忽略目录 .local-validation/cli-user-alignment/round4-mail-*.json。

目录误拒的原场景及修复见 [原 CLI 处理器](../../../xrain-workforce/tests/cli-api.test.mjs)和[应用目录](../../../xrain-workforce/tests/application-directory.test.mjs)。CLI 使用应用声明的普通 openUrl，浏览器继续使用本人的会话地址；导航准入不构造页面地址。原浏览器的会话和准入限制保持原义。

本机宿主已通过 Workforce 的源码预览入口正常重载。独立 CLI 目录读取成功且 incomplete=false，邮箱条目的 openUrl 与 launchUrl 均存在；组合回读包含 mail 路由。团队 DeskPilot 已沿门户应用中心完成邮箱独立授权、回到原门户位置及本人连接读取。接入参数按认证中心的精确 issuer 和 OIDC 登录 scope 修正，未放宽回执校验。

同一跨应用测试成员在门户内取得 DeepSeek 摘要和回复草稿。页面明确保存的一份合成草稿，经统一退出和从门户重新登录后仍只有一条匹配，中文正文与校验标识完整。门户切回原账号前提示处理未保存草稿；确认放弃后旧成员界面清除。门户和邮箱正常退出后，邮箱原会话接口返回 401 identity.login_required。非秘密断言与截图保存在忽略目录 .local-validation/cli-user-alignment/round6-*.json 和 round6-*.png。

邮箱应用已选用专用 workforce-mail-assistant，CLI 回读显示可用且为默认项。摘要与拟稿实际使用本机已有 deepseek-official / deepseek-flash；生成后没有新增对应草稿，明确保存后只查到一条，新的 CLI 进程按原引用读回完整正文。未选用的 anbang-sales 仍返回 403 ephemeral_ai_unavailable。非秘密证据位于忽略目录 .local-validation/cli-user-alignment/round5-*.json。

本机已构建的原 XRain 元数据 AppService 在隔离测试存储中接受 2160 字符请求键，对象创建、字段创建及失败部署修正均成功；重复同键没有重复创建。使用的是 2026-10-31 23:52 的既有构建，当前源码的相应请求键处理未变化。此证据属于原服务组件验证，不代表共享租户结构写入已验证。

共享平台实读复用 anbang-dev01 的已有 xrain-test-host 身份和租户 00k01a1551dfeae60vvl。企业列表、查询能力、顾客对象导入/导出能力与同身份原接口结果一致。不存在对象返回相同 404 和业务错误；现部署的 gender__c 选项请求返回相同 400，未把现部署不支持该字段请求改报为成功。模板从原服务下载为 5276 字节；此事实只证明该对象当次模板请求。

同一对象的模板请求还接受了 90166 字节的有效选项，返回 247529 字节模板。该原服务结果证明模板不能套用分块上传的 65536 字节选项限制；CLI 对分块上传仍保留该原协议限制。

测试市场的公开目录用无登录状态读取，与网页原接口同为 200 和空列表。此结果证明匿名目录可达，不能证明非空包的版本查看、下载或安装已在该环境实测。

以下保留为未验证，不归并成“全功能真实闭环通过”：

- Workforce 与 Runtime：真实提问审批、页面与CLI反馈、Android反馈、文件转写及当前15380计划修复已由上述独立测试补证；Android录音失败，Electron、iOS、实际录音取消、不自动发送及各端待批页面仍未完整验证，不能扩写为全部功能通过。
- 邮箱与公共子应用：本轮固定身份和邮箱路径已实测；跨企业、撤权后的实际重入仍未完整实测。其他定义和业务授权保留。
- XRain 平台：共享结构修改、导入提交、分享写入和应用包安装未执行。按原任务需要在获准隔离数据范围补证，服务允许及拒绝分支的当前证据以源码和定向测试为界。

本轮确认的 CLI 缺项及独立应用适配缺陷已按原契约修正。受管单次执行的持久恢复和按 runId 取消仍无当前服务协议，不能由 CLI 编造。账号绑定与企业代登录确认继续使用原网页；本机显示偏好、窗口、动画、焦点及设备安装不复制成远端业务状态。

## 事实所有者

- XRain 范围：[产品能力边界](../../../all_in_one/文档/项目/项目_XRain/产品契约/DOC-0020-低代码平台功能树.md)。
- Workforce 范围：[产品需求目录](../../../xrain-workforce/文档/项目/项目_XRAIN_WORKFORCE/PRD/PRD-0000-功能目录.md)。
- Runtime 执行：[受管执行](../../../xrain-harness/packages/xrain-agent-runtime/src/managed-agent-runs.ts)、[临时文本](../../../xrain-harness/packages/xrain-agent-runtime/src/ephemeral-runs.ts)与[工作台](../../../xrain-harness/packages/xrain-agent-runtime/src/workbench.ts)。
- CLI 使用与恢复：[设计](DESIGN.md)、[完整命令说明](../../skills/shzw-xrain-cli/references/commands.md)、[Workforce](../../skills/shzw-xrain-cli/references/workforce.md)与[公共子应用](../../skills/shzw-xrain-cli/references/applications.md)。

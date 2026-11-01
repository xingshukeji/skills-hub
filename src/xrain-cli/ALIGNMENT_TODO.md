# XRain CLI 用户功能对齐

核对日期：2026-11-01。范围：当前 Node.js CLI、XRain 平台、Workforce、Runtime 和现有公共子应用。任务类型为 Development。CLI 由 skills-hub 维护，各产品保留业务规则和状态所有权。

## 判断口径

按用户从发现入口、读取与操作、取得回执、保存后重入到失败后继续的任务核对。命令存在只证明可达；源码、CLI 替身、原处理器隔离验证和共享环境实读分别记录。旧 .NET CLI 保持退役。

本轮复审修复了应用目录和本人功能组合误用浏览器会话地址的问题，并用 deploy-ops 登记的固定 163 邮箱补齐平台 CLI、独立邮箱 CLI 和实际页面的保存重入验证。后续已按用户要求重载本机宿主，并使用现有 DeepSeek 完成邮箱摘要、拟稿、明确保存及新进程回读。门户卡片及打开路由已验证，邮箱统一登录页的浏览器控制仍受阻。下表保留前轮结果；“实现对齐”表示已找到对应业务入口及恢复路径，不表示每个真实角色都完成了实环境验收。

## 用户任务对照

| 用户任务 | 当前 CLI 与原业务结果 | 当前判断和证据范围 |
|---|---|---|
| 连接、统一登录、发现与切换企业、核对身份和应用准入 | profile 与 auth 使用平台登录；会话绑定服务器、租户和作用域。Workforce、邮箱和接待使用本人会话及实际应用。切换后不借用旧目标配置。 | 实现对齐。管理员的当前身份、企业发现与原接口结果一致。独立邮箱已用固定普通 SSO 用户完成正常密码登录、回调、退出和重登；真实跨企业操作仍未验证。 |
| 设计对象、字段、视图、选项和记录类型，删除后恢复 | metadata 保留 ETag、创建请求键、删除影响令牌及失败部署恢复；请求键按原 Header 传递，不借用记录创建的 160 字符规则或额外 Header 长度上限。recycle 使用平台原回收站。 | 已修复元数据误拒。对象创建、字段创建和失败部署修正均验证较长原键、服务拒绝及回执丢失；记录创建的原限制保留。未在共享租户修改结构。 |
| 查询与写入记录、选用视图、分享、转移负责人和查看历史 | data 与 metadata view 复用平台查询、记录、共享及历史；单记录创建可用原 requestKey 回查，集合保留逐项结果。已提交但回执过大时仍报告 outcome_unknown。 | 已修复大回执的结果语义。源码及独立包验证超过 32 MiB 的回执保留原键，回查找回记录且只创建一次。实读查询能力与原接口一致；未写共享业务数据。 |
| 取模板、检查完整文件、分块导入、暂停恢复、导出文件 | data import capabilities 返回当前能力及不可用原因；template 独立调用原模板服务，不套用分块资格、上传文件或选项大小限制；作业仍核对当前资格和计划修订，保留已提交进度。 | 已修复模板误拒。隔离验证覆盖分块不可用但模板允许、原服务拒绝、分块选项限制保留、断流和文件不覆盖；共享平台能力结果与原接口一致，模板实际下载成功。真实导入提交未执行。 |
| 上传下载文件、附件和原始响应 | file、Workforce attachment 及原始输出流式传递；服务决定业务限额，客户端保留长度、摘要、清单解码、临时文件及不覆盖保护。 | 实现对齐；本轮沿既有大文件、拒绝、断流、磁盘失败与恢复测试复验，不把本地资源预算当作业务配额。 |
| 找人、单聊群聊、群管理、消息编辑撤回、转发、搜索、草稿和附件 | workforce people/channel/group/message/search/draft/attachment 沿原处理器；各转发目标独立提交，来源范围和版本不变。 | 实现对齐；当前 CLI 与宿主隔离回归核对身份、群角色、冲突和范围，未发送真实消息。 |
| 应用机器人发通知并查回执 | application-message 使用原执行者凭据和 clientMessageId，区分 accepted、saved、failed 和 unknown；不借成员接口发布。 | 实现对齐；原发布处理器及独立 CLI 消费验证，未向真实群或公告发布。 |
| 建立和交办 Task、改派、状态、挂载、提醒及执行对话 | workforce task 保留原任务；创建、确认、改派或重开后的挂载/AI 接纳失败返回 partial_success，batch 停止并保留失败步骤回执。 | 已修复部分完成误报。原处理器验证 AI 拒绝后原任务恢复且不重复执行；CLI 验证只写一次、停止后续步骤、读取原任务和服务拒绝。accepted 不表示 AI 已完成。 |
| 建立和修改计划、启用暂停、读历史、处理问题和取消运行 | workforce schedule 调用原计划及运行接口；主体凭据、调度和执行历史由宿主持有。 | 实现对齐；按原服务已有动作核对，不编造原产品未提供的计划删除等功能。真实调度运行未验证。 |
| 定义、工具、工作区、订阅和应用选用 | agent definition/tool/workspace/policy/subscription/application 使用原版本、工具目录和资格；定义直接读摘要、单条及当前限额，启停使用状态接口，导入 null 恢复工具继承。保存后读原定义，申请不等于批准。 | 已删除旧 Runtime 回退与猜定上限。缺失接口、无效限额、并发和继承证据保留。按用户授权，独立邮箱助手已通过 CLI 创建为停用、按原修订启用，并保存和回读邮箱完整选用项；复用现有 DeepSeek、工作区和工作模式，保留其他定义与订阅。 |
| 与助手对话、续聊、回读工具和终态、提问审批、取消与恢复 | agent chat 与 workforce session 保留原 sessionId/requestId；等待或回读不重发。toolCalls 和 history 保留原 callId 及工具结果 result，包含正文、错误和元数据；凭据脱敏。轮次完成但没有文字仍成功，工具失败单独保留。Ctrl+C 只结束本地观察。 | 已修复工具回执丢失。源码及独立包验证成功、工具失败、轮次失败、新进程重入历史、原权限拒绝和凭据脱敏；已有迟到回执、断流及分页回归保留。真实模型与工具闭环未验证。 |
| 受管单次执行与临时文本 | agent run start/show 按原 runId 查询服务的有界结果；ephemeral 使用原纯文本协议，没有持久会话、工具和历史。 | 与当前服务能力对齐。受管回执丢失没有客户端请求键可恢复，当前服务也无受管 runId 取消接口；CLI 如实保留未知，不另造恢复状态或自动重放。 |
| 回答反馈和语音 | workforce session feedback 与 speech 复用原会话、回答、本人反馈和 speech Remote；语音识别不自动发送。 | 实现对齐；原处理器与 CLI 隔离验证已覆盖撤销、非助手回答、失权、服务未就绪及原音频输入。未下载模型或录制真实音频。 |
| 本人功能组合、应用目录、账号绑定和企业管理 | composition 保存本人的选择；applications 返回实际准入和普通浏览器入口，不生成浏览器会话专用地址。导航选择只核对准入。account/enterprise open 返回或打开原确认页面；平台 security/host 管理已有成员和角色。 | 已修复目录及组合选用误拒。原处理器的查询、保存和重入通过；原宿主正常重载后，独立 CLI 已返回完整应用目录及邮箱普通打开地址，组合包含邮箱路由。门户实际登录后显示邮箱卡片，点击进入邮箱路由并转到邮箱自己的统一登录页；后续页面控制超时。 |
| 独立邮箱：账户、文件夹、搜索、原邮件、AI 和草稿 | mail 访问原邮箱；app search/read 保留原 reference，assist 仅返回建议。平台和应用的 draft 共享 Saved、internetMessageId 和原账号检查；服务的 email_draft_outcome_unknown 保留未知语义。 | 真实固定 163 邮箱的认证、平台与应用 CLI 草稿回读、前轮页面保存及退出重登证据保留。独立 CLI 已用 DeepSeek 返回中文摘要与拟稿；生成不自动保存，明确保存后由新进程完整读回唯一草稿。普通成员隔离、原 409 及错误应用拒绝保留；未选用的销售助手仍为原 403。未发送邮件。邮箱 AI 页面与门户内完整使用尚未验证。 |
| 顾客接待：查询、登记、编辑、字段选项和继续原对话 | retail context/customer/options 使用实际对象和字段；selected 可传多个原值。conversation 复用原顾客、本人和 AI 的会话，明确 createNew 才另开。 | 已补字段选项。原应用用相同身份、租户、应用和输入对照网页与 CLI 路径，结果一致；失去字段权限、换对象或撤销准入后拒绝。保存、冲突和顾客关联由原处理器隔离验证。 |
| 应用管理、市场和应用包开发安装 | application 管理治理；app 构建、发布、导入、安装、升级及操作恢复；market 按精确版本读包，核验身份和摘要，公开包允许匿名浏览。 | 实现对齐；继续区分包已安装、应用已准入和 Workforce 目录可打开。现有定向测试覆盖服务拒绝、恢复和制品完整性，本轮未发布或安装真实包。 |

## 验证与未验证范围

CLI 定向及完整 Skill 消费测试见 [导入](../../tests/data-import.test.mjs)、[Task 回执](../../tests/workforce-cli.test.mjs)、[用户功能](../../tests/user-functions.test.mjs)和[独立消费](../../tests/cli-alignment-bundle.test.mjs)。顾客原入口对照见 [独立应用测试](../../../xrain-workforce/applications/retail-assistant/tests/server.test.mjs)，Task 的保存和重入见 [原回执测试](../../../xrain-workforce/tests/task-write-receipts.test.mjs)。

前轮证据见[工具回执与重入](../../tests/cli-tool-receipts.test.mjs)、[元数据请求键](../../tests/metadata-operations.test.mjs)及[记录创建恢复](../../tests/cli-record-creation.test.mjs)。CLI 隔离验证覆盖原工作台的 tool-role 和嵌套 tool-result 格式，保留正文、错误及元数据。历史查询仍由 Runtime 按原会话授权，不建立另一套历史。

本轮新增证据见[草稿结果与查询恢复](../../tests/mail-draft-outcome.test.mjs)、[当前定义接口](../../tests/cli-definition-settings.test.mjs)和[独立包定义消费](../../tests/cli-agents-bundle.test.mjs)。草稿的 Saved 回执允许 reference 为空；缺少 internetMessageId、非 Saved 状态或引用了其他账号时，保留原结果为未知。恢复只查询原邮箱的文件夹、草稿搜索和原引用，没有再次保存。定义测试覆盖缺失接口、无效限额、原版本冲突、限额不可用时的启停，以及导入恢复工具继承。

前轮 Workforce 原邮箱 HTTP 处理器与原 MailXRainClient 在隔离上游下，对 CLI 和网页入口返回相同的未知结果、账号冲突和身份拒绝。原 XRain PersonalEmailApiTests 的稳定错误测试也验证了 HTTP 409 的 email_draft_outcome_unknown。该组仍属于组件证据。

本轮真实邮箱复用 deploy-ops 的固定 163 测试邮箱及既有凭据引用，使用当前共享平台和原租户。平台 CLI 与独立邮箱 CLI 各保存一份合成草稿，并在新进程按原引用读回同一中文正文；没有发送邮件。原生 test 成员列不到维护者连接，读取该连接返回 404 email_account_not_found；失效 uidValidity 的回复草稿返回 409 email_reference_stale，原草稿仍可读取。独立应用 ID 改为另一应用时返回 409 cli.context_changed。

独立邮箱已按用户授权登记自己的应用和公开 OIDC 客户端。本机实际页面用既有 workforce-user-20261017 登录，添加本人的固定邮箱连接并完成收发认证；随后读取 CLI 草稿、保存浏览器草稿、统一退出、重新登录并读回完整中文。实例参数和启动由 [邮箱共享测试接入](../../../xrain-workforce/文档/项目/项目_XRAIN_WORKFORCE/运行/RUN-0013-独立邮箱共享测试接入.md)持有；本机证据在忽略目录 .local-validation/cli-user-alignment/round4-mail-*.json。

目录误拒的原场景及修复见 [原 CLI 处理器](../../../xrain-workforce/tests/cli-api.test.mjs)和[应用目录](../../../xrain-workforce/tests/application-directory.test.mjs)。CLI 使用应用声明的普通 openUrl，浏览器继续使用本人的会话地址；导航准入不构造页面地址。原浏览器的会话和准入限制保持原义。

本机宿主已通过 Workforce 的源码预览入口正常重载。独立 CLI 目录读取成功且 incomplete=false，邮箱条目的 openUrl 与 launchUrl 均存在；组合回读包含 mail 路由。内置浏览器已完成门户登录、应用中心卡片、点击打开及门户正常退出；邮箱使用自己的统一登录页。内置浏览器和 Chrome 在该页读取状态均超时；邮箱身份、AI 操作及邮箱退出清理仍未复验，不能据此认定产品登录失败。

邮箱应用已选用专用 workforce-mail-assistant，CLI 回读显示可用且为默认项。摘要与拟稿实际使用本机已有 deepseek-official / deepseek-flash；生成后没有新增对应草稿，明确保存后只查到一条，新的 CLI 进程按原引用读回完整正文。未选用的 anbang-sales 仍返回 403 ephemeral_ai_unavailable。非秘密证据位于忽略目录 .local-validation/cli-user-alignment/round5-*.json。

本机已构建的原 XRain 元数据 AppService 在隔离测试存储中接受 2160 字符请求键，对象创建、字段创建及失败部署修正均成功；重复同键没有重复创建。使用的是 2026-10-31 23:52 的既有构建，当前源码的相应请求键处理未变化。此证据属于原服务组件验证，不代表共享租户结构写入已验证。

共享平台实读复用 anbang-dev01 的已有 xrain-test-host 身份和租户 00k01a1551dfeae60vvl。企业列表、查询能力、顾客对象导入/导出能力与同身份原接口结果一致。不存在对象返回相同 404 和业务错误；现部署的 gender__c 选项请求返回相同 400，未把现部署不支持该字段请求改报为成功。模板从原服务下载为 5276 字节；此事实只证明该对象当次模板请求。

同一对象的模板请求还接受了 90166 字节的有效选项，返回 247529 字节模板。该原服务结果证明模板不能套用分块上传的 65536 字节选项限制；CLI 对分块上传仍保留该原协议限制。

测试市场的公开目录用无登录状态读取，与网页原接口同为 200 和空列表。此结果证明匿名目录可达，不能证明非空包的版本查看、下载或安装已在该环境实测。

以下保留为未验证，不归并成“全功能真实闭环通过”：

- Workforce 与 Runtime：真实消息、计划、工具执行、反馈及语音闭环仍未完整验证；邮箱的临时文本结果不代替这些持久场景。
- 邮箱与公共子应用：原宿主和 AI 已配置并完成 CLI 实测。门户内邮箱的统一登录页控制超时，后续身份、AI 页面及退出清理尚未复验；先恢复该页的浏览器观察，再沿原卡片完成。跨企业、撤权后的实际重入仍未完整实测。保留其他定义和业务授权。
- XRain 平台：共享结构修改、导入提交、分享写入和应用包安装未执行。按原任务需要在获准隔离数据范围补证，服务允许及拒绝分支的当前证据以源码和定向测试为界。

本次没有需要另行产品决定的 CLI 差距。若要求受管单次执行具备持久恢复或按 runId 取消，应先由 Runtime 确认产品承诺和原生协议；不能以客户端命令存在代替服务能力。纯布局、窗口、动画和本地焦点不复制为 CLI 功能。

## 事实所有者

- XRain 范围：[产品能力边界](../../../all_in_one/文档/项目/项目_XRain/产品契约/DOC-0020-低代码平台功能树.md)。
- Workforce 范围：[产品需求目录](../../../xrain-workforce/文档/项目/项目_XRAIN_WORKFORCE/PRD/PRD-0000-功能目录.md)。
- Runtime 执行：[受管执行](../../../xrain-harness/packages/xrain-agent-runtime/src/managed-agent-runs.ts)、[临时文本](../../../xrain-harness/packages/xrain-agent-runtime/src/ephemeral-runs.ts)与[工作台](../../../xrain-harness/packages/xrain-agent-runtime/src/workbench.ts)。
- CLI 使用与恢复：[设计](DESIGN.md)、[完整命令说明](../../skills/shzw-xrain-cli/references/commands.md)、[Workforce](../../skills/shzw-xrain-cli/references/workforce.md)与[公共子应用](../../skills/shzw-xrain-cli/references/applications.md)。

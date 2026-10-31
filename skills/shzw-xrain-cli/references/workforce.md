# Workforce 业务命令

成员操作使用已有平台租户登录会话，明确指定服务方提供的 `--workforce <宿主origin>` 和真实 `--application-id <Workforce应用ID>`；追加 `--profile <平台> --auth session --json`。平台凭据会发送到该宿主的专用 CLI API。宿主逐次核验真实主体、租户和应用准入，平台 API Token、网页 Cookie 或其他租户不能代替这次平台登录。宿主需要包含 `/api/cli/v1` 的兼容版本；旧部署返回 404 时不改走网页路由。应用消息发布使用下述原发布 API 及其执行者凭据。

## 人员与沟通

```text
workforce context
workforce people
workforce employee profile
workforce employee agents <本人userId>
workforce channel list
workforce channel dm --request-json <私聊.json>
workforce channel group --request-json <群.json>
workforce message list <channelId> --query-json <分页.json>
workforce message show <channelId> <messageSeq>
workforce message send <channelId> --request-json <消息.json>
workforce message edit <channelId> <messageSeq> --request-json <编辑.json>
workforce message withdraw <channelId> <messageSeq> --request-json <撤回.json>
workforce message search <channelId> --query-json <搜索.json>
workforce channel leave <channelId> --request-json <退出.json>
```

people 返回当前人可见的目录；employee profile 和 agents 读取本人工作资料及既有智能体关系。协作通过原私聊、消息与 Task 进行，不另建员工或替换关系。dm 请求为 `{"otherUserId":"<已有成员>"}`；group 请求为 name、memberIds、invitePermission（members 或 managers）、searchable、approvalRequired，可带稳定 requestId。

消息请求保留稳定 clientMessageId，正文用 text，可带原平台支持的 replyTo、mentions、attachments、richBlocks；不附带任意发送者身份。edit 为 text、expectedRevision；withdraw 为 expectedRevision。消息列表查询为 before、after、limit，搜索为 q、before、limit、category、senderId。退出为 `{}`，群主移交时显式带 successorId。发送必须有用户要求，回执丢失保留原 clientMessageId，先回读，不自动重发。

## 群管理、消息与附件

下列命令沿用上面的 Workforce 地址和身份参数。群状态返回 revision、成员和待处理申请；修改设置和审批使用实际读取的版本。

```text
workforce group show <channelId>
workforce group update <channelId> --request-json <设置.json>
workforce group invite <channelId> --request-json <邀请.json>
workforce group apply <channelId> --request-json <申请.json>
workforce group decide <channelId> <requestSeq> --request-json <决定.json>
workforce group member-role <channelId> <userId> --request-json <角色.json>
workforce group remove-member <channelId> <userId>
workforce group transfer <channelId> --request-json <转让.json>
workforce message forward <目标channelId> --request-json <转发.json>
workforce message react <channelId> <messageSeq> <emoji> --request-json <回应.json>
workforce message read <channelId> --request-json <已读.json>
workforce message read-all <channelId>
workforce message unread <channelId>
workforce draft get <channelId>
workforce draft set <channelId> --request-json <草稿.json>
workforce search --query-json <跨会话搜索.json>
workforce attachment upload --file <本地文件>
workforce attachment list <channelId> --query-json <分页.json>
workforce attachment download <fileId> --query-json <原消息.json> --out <新文件>
```

设置为 expectedRevision、name、searchable、invitePermission、approvalRequired。邀请为 `{"userIds":["<已有成员>"]}`；从返回的 entryEvidence 中取本人对应凭据提交申请，不生成或复用别人的凭据。公开群申请可用 `{"source":"public_search"}`。决定为 applicantUserId、decision（approve 或 reject）、expectedRevision。角色为 `{"role":"admin"}` 或 member；转让为 `{"targetUserId":"<现有成员>"}`。原群主、管理员和普通成员规则均由宿主执行。

转发为 sourceChannelId、sourceMessageSeqs、mode（merged 或 individual）、稳定 clientMessageId，可带 note；位置参数是目标频道。每个目标使用一个请求；批量操作为每个目标保存各自结果，失败后停止后续命令。转发不授予来源会话读取权。回应为 `{"active":true}`，撤销用 false。已读为 `{"messageSeqs":["<原序号>"]}`；read-all 和 unread 不接请求文件。

草稿为 `{"expectedRevision":"<已读版本>","draft":{"text":"<内容>","replyToSeq":null,"attachments":[],"richBlocks":[],"mentionUserIds":[]}}`。冲突时回读并由本人合并，不自动覆盖。跨会话搜索支持 q、channelId、channelIds（逗号分隔）、before、limit、category、senderId、since、field、fileType；只检索当前可读频道，保留 nextCursor 和 incomplete。

附件上传返回原文件信息；把返回的文件 ID 和原文件信息填入 message send 的 attachments，再发入原会话。上传本身不发送消息。附件列表支持 before、limit；下载的查询为 `{"channelId":"<原频道>","messageSeq":"<原消息序号>"}`。文件服务和原宿主决定文件大小规则，CLI 不另设下载上限。宿主独立核验文件和会话资格；CLI 流式保存下载，校验已声明的响应长度，不覆盖已有文件，也不把错误响应保存成附件。断流或本地写入失败时清理本次临时文件。

## 应用通知与公告

```text
workforce application-message send --workforce <宿主origin> --request-json <发布.json>
workforce application-message lookup <发布applicationId> <原channelId> <原clientMessageId> --workforce <宿主origin>
```

这两个命令消费原 `/api/application-messages` 发布和回查入口。指定原平台 profile 与已获发布权限的执行者凭据；默认使用现有凭据选择，显式 `--auth session` 使用已有平台登录。执行者的应用发送权限、机器人绑定和目标资格由原服务核验。这里不要求 Workforce 应用 ID；lookup 的 applicationId 是原发布应用，不能替换为宿主应用。

发布对象为 `{"applicationId":"<发布应用>","target":{"kind":"application"},"clientMessageId":"<稳定原请求号>","content":{"type":"text","text":"<通知正文>"}}`。target 还可为 `{"kind":"user","userId":"<原成员>"}` 或 `{"kind":"group","channelId":"<原群>"}`。content 沿原消息类型及附件、Task 引用规则；机器人是消息作者，执行者凭据只承担授权。命令不创建机器人、不自动授权或加入目标群。

保存原 applicationId、target、clientMessageId 和回执 channelId。accepted 只表示受理，saved 才表示已保存；failed 返回失败，查询到 unknown 表示尚未确认。结果不明时不自动重发。有原 channelId 时使用 lookup 查询同一请求；未知 channelId 时保留原请求和目标核查，不按目标另建请求或批量重发。

## 本人功能、应用与账号页面

```text
workforce composition get
workforce composition set --request-json <本人选择.json>
workforce applications
workforce account open [--no-browser]
workforce enterprise open [--no-browser]
```

composition get 返回当前选择、可选功能和依赖。set 提交 `{"plugins":["<实际插件ID>"],"applications":["<实际目录ID>"]}`；完整保留仍需使用的选择，恢复默认用 `{"reset":true}`。可用 `--query-json` 指定 client（web 或 desktop）。关闭功能只修改本人的在线选择，不删除数据。applications 返回本人实际可用目录、打开地址和 incomplete；应用安装列表不能代替它。

account open 打开原个人设置，绑定登录方式仍需本人验证和第三方授权。enterprise open 打开企业管理，选择成员、确认代登录和返回原账号均在原网页完成。命令只报告网页入口和预期身份；浏览器登录可能不同，先核对当前企业和本人。`--no-browser` 仅返回地址；返回 requires_browser_interaction 不表示绑定或身份切换已经完成。

## Task 与原生会话

```text
workforce task list
workforce task show <taskId>
workforce task create --request-json <任务.json>
workforce task update <taskId> --request-json <修改.json>
workforce task confirm <taskId>
workforce task status <taskId> --request-json <状态.json>
workforce task assist <taskId> --request-json <协作.json>
workforce task attach <taskId> --request-json <频道.json>
workforce session create --request-json <会话.json>
workforce session list --query-json <来源.json>
workforce session history <sessionId>
workforce session send <sessionId> --request-json <输入.json>
```

创建和修改沿 Task 原生 description、assigneeId、dueAt 及挂载字段；只提交实际变化，不用状态更新绕过草稿确认。status 为 `{"status":"<允许的当前目标状态>"}`；assist 为 agentUserId、instruction；attach 为 channelId。本人提醒使用 task reminder get/set，set 为 enabled。Task 执行会话读取用 task execution-conversation。

Task 会话请求为 `{"taskId":"<原任务>","source":"xrain-cli","requestId":"<原请求>"}`，可显式带已获权的 agentId。宿主签发并保管 grant，CLI 不接收该值。本人普通会话改用 agentId，保留明确应用来源。session list 查询 source 使用创建时的来源；默认 workbench，读取 CLI 来源时显式为 xrain-cli。send 请求沿 Runtime 的 requestId、content 原输入结构；受理不代表本轮完成，回读原 session 的 history/pending 判断。

session 还支持 subagents、commands、models 读取，command、model、respond、cancel-question 带原请求对象；cancel 明确停止原运行。respond/cancel-question 以 action-ref 定位，带原 responseId 和明确答案或审批决定。审批不得自动放行。Task 改派、撤权、暂停或恢复后的旧 grant 不得继续写入。

session command 按[智能体命令](agents.md)中的原生执行结果判断成功、失败及未知回执；失败停止 batch，查询原历史不改变其业务状态。

## 回答反馈与语音

```text
workforce session feedback list <原sessionId>
workforce session feedback set <原sessionId> --request-json <反馈.json>
workforce speech catalog
workforce speech configure --request-json <配置.json>
workforce speech prepare --request-json <准备.json>
workforce speech cancel-preparation --request-json <取消准备.json>
workforce speech transcribe --file <本地.wav> [--request-json <选择.json>]
```

反馈使用本人原会话和助手回答序号：`{"messageId":"<assistant/message的seq>","rating":"negative","category":"task-result","note":"<意见>"}`。rating 可为 positive、negative 或 null。category 可为 null、task-result、instruction-following、product-interaction、service-stability、resource-cost、security-privacy-permission 或 other；note 最多 8000 字符。撤销用同一 messageId 提交 `{"messageId":"<原序号>","rating":null,"category":null,"note":""}`。原 Runtime 核验会话访问，原反馈存储按本人隔离；只有 saved=true 才报告提交完成。

先用 speech catalog 读取现有 provider、selection、准备状态和音频能力。configure 请求为 `{"patch":{"providerId":"<目录ID>","language":"zh"}}`；只修改需要的字段。prepare、cancel-preparation 请求为 `{"providerId":"<目录ID>"}`，prepare 可带原服务的 options。准备动作须来自用户明确要求，不因转写失败自动下载或准备模型。配置和准备返回原服务的当前目录；未集成或未就绪时保留原不可用结果。

transcribe 的 --file 读取原始 16 kHz 单声道 PCM WAV；可用选择.json 覆盖 providerId、language，其余选择和输入大小上限取当前服务目录。CLI 只把原字节编码为 audioBase64，不解码、重采样或复制识别逻辑。不传 --file 时，可用 --request-json 提交原 `{providerId,language,audioBase64}` 对象。返回 text 供本人确认，转写本身不向会话发送消息。

## Workforce 计划任务

`workforce schedule` 支持 list/options/bootstrap/agents/models、create/update、enable/pause、history；update、enable、pause、history 带 schedule-id。create/update 的请求为 name、description、ownerId、assigneeId、agentId、scheduleType、executeTime、timeZoneId，可带 provider、model、reasoningEffort；scheduleType 为 Daily 或 Workday，executeTime 为 HH:mm，timeZoneId 使用平台 IANA 选项。保存默认 Paused，只有原 assignee 可以明确 enable；修改前先 pause。

启用时宿主复核并保存同一成员的原凭据，不改执行身份。history 保存原 runId；`workforce schedule run conversation/pending-actions/respond/cancel-action/cancel <scheduleId> <runId>` 沿原运行回读或响应，respond/cancel-action 带 actionRef 和 response。旧平台安排可读历史和 pause，编辑、enable 不会恢复旧执行链。周期安排和员工一次性检查继续由宿主调度与恢复，CLI 不另起调度进程。

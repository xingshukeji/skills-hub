# Workforce 业务命令

使用已有平台租户登录会话，明确指定服务方提供的 `--workforce <宿主origin>` 和真实 `--application-id <Workforce应用ID>`；追加 `--profile <平台> --auth session --json`。平台凭据会发送到该宿主的专用 CLI API。宿主逐次核验真实主体、租户和应用准入，平台 API Token、网页 Cookie 或其他租户不能代替这次平台登录。宿主需要包含 `/api/cli/v1` 的兼容版本；旧部署返回 404 时不改走网页路由。

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

## Workforce 计划任务

`workforce schedule` 支持 list/options/bootstrap/agents/models、create/update、enable/pause、history；update、enable、pause、history 带 schedule-id。create/update 的请求为 name、description、ownerId、assigneeId、agentId、scheduleType、executeTime、timeZoneId，可带 provider、model、reasoningEffort；scheduleType 为 Daily 或 Workday，executeTime 为 HH:mm，timeZoneId 使用平台 IANA 选项。保存默认 Paused，只有原 assignee 可以明确 enable；修改前先 pause。

启用时宿主复核并保存同一成员的原凭据，不改执行身份。history 保存原 runId；`workforce schedule run conversation/pending-actions/respond/cancel-action/cancel <scheduleId> <runId>` 沿原运行回读或响应，respond/cancel-action 带 actionRef 和 response。旧平台安排可读历史和 pause，编辑、enable 不会恢复旧执行链。周期安排和员工一次性检查继续由宿主调度与恢复，CLI 不另起调度进程。

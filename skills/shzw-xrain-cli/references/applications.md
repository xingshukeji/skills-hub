# 邮箱 AI 与顾客接待

这些命令使用已保存的平台租户登录会话。追加同一 `--profile <平台连接> --app-url <独立应用origin> --application-id <该应用实际ID> --auth session --json`。邮箱与接待应用的地址和 ID 分别取其实际接入配置；不使用 Workforce ID 或猜测 Runtime 地址。应用逐次核验真实主体、租户、预期身份和自身准入。旧部署不支持专用 CLI 路径时返回 404，不能转用网页 Cookie 绕过。

## 在原邮件中使用 AI

1. 运行 `mail app accounts`，选定本人的邮箱。使用 `mail app folders <accountId>` 查询原文件夹。
2. 运行 `mail app search <accountId> --request-json <搜索.json>`。查询使用 folder、text、limit 和原 nextCursor；按发件人筛选时用 sender，不能同时指定 text。
3. 运行 `mail app read <accountId> --request-json <原邮件.json>`。请求为 `{"reference":<搜索返回的完整reference>}`，保留 accountId、mailbox、folder、uidValidity 和 uid。
4. 运行 `mail ai list`，从目录中选择当前 canUse 的 AI。需要申请个人订阅时运行 `mail ai subscribe <agentId>`；申请不等于已获批准。
5. 运行 `mail assist <accountId> --request-json <协助.json>`，取得摘要或可编辑回复。
6. 本人确认回复后，运行 `mail app draft <accountId> --request-json <新草稿.json>`，保存到原邮箱。

协助请求示例：

```json
{
  "agentId": "<已获权AI>",
  "reference": { "accountId": "<原邮箱>", "mailbox": "<原邮箱地址>", "folder": "INBOX", "uidValidity": 17, "uid": 31 },
  "action": "draft",
  "instructions": "确认参加并询问会议地点"
}
```

action 为 summary 或 draft；instructions 可省略，最多 2000 字符。协助读取原邮件并使用应用的临时 AI 请求，不建立持续对话，不发送或自动保存。结果的 materialTruncated 和 attachmentsRead 说明材料范围。邮箱被修改、停用或撤权时，应用拒绝交付过期结果。

新草稿使用 to、cc、bcc 地址对象数组、subject、textBody；回复关联放在 source 中，值为原完整 reference。保存新草稿成功返回 status=Saved 和 internetMessageId；可能同时返回新草稿 reference。保存回执丢失时保留原邮箱与原邮件，先检查原邮箱草稿，不自动重复保存。个人邮箱命令不增加发送、删除、移动或归档动作。

## 从顾客资料继续原接待

1. 运行 `retail context`，读取本企业的实际 objectType、字段定义、可读/可创建/可编辑字段及初始顾客。不要把别的企业字段写入当前对象。
2. 运行 `retail customers --query-json <筛选.json>`。支持 search、order、cursor、includeArchived、archivedOnly；沿返回游标继续查询。
3. 运行 `retail customer describe <objectType>` 或 `retail customer show <objectType> <recordId>`，核对原资料和字段权限。
4. 运行 `retail conversation list <objectType> <recordId>`，找到本人在原顾客下的既有对话；运行 `retail agents` 选择有权使用的 AI。
5. 运行 `retail conversation start <objectType> <recordId> --request-json <对话.json>`。请求为 `{"agentId":"<选定AI>","requestId":"<稳定请求ID>"}`；默认来源是 retail-assistant。相同顾客和 AI 已有对话时返回 items，由本人选定原 sessionId；明确另开话题时增加 createNew=true。
6. 使用 `retail session history <sessionId>` 回读原历史，再用 `retail session send <sessionId> --request-json <输入.json>` 继续。输入沿 Runtime 的 requestId、content 原结构。受理不代表本轮完成，继续读取 history 和 pending。

登记顾客使用 `retail customer create <objectType> --request-json <资料.json>`；修改使用 `retail customer update <objectType> <recordId> --request-json <修改.json>`。请求为 values，修改可带 expectedValues；创建仅接受接待应用实际开放的登记字段。保存后用 customer show 回读原记录。冲突或失权时不自动覆盖，也不切换其他对象或身份。

`retail agent-catalog` 提供可发现目录，`retail subscribe <agentId>` 申请个人订阅。对话还支持 subagents、commands、models、command、model、cancel、pending、respond、cancel-question；请求沿原工作台 DTO。命令结果为失败时返回非零退出码。所有操作使用同一应用及本人原会话；审批必须有明确决定，停止或回执不明不自动重发。

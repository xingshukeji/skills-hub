# 定时任务诊断与恢复

本页补充 Workforce 一句话定时任务的诊断与恢复。命令由完整 CLI Skill 执行；目标、应用和已保存成员身份须与原请求一致。

## 先核对工具来源

普通成员可用 agent directory --application-id <应用ID> 读取本人目录，核对 supportsDefaultServiceTools 和 serviceToolProtocolVersions。字段缺失表示当前 Runtime 未声明该能力，不能从包版本号或 completed 推断默认工具已经加载。

有原定义管理权限时，使用 agent definition options、agent tool business 及 agent tool show <定义ID>。business 保留服务返回的 protocolVersion、defaultAvailable、entries、targetApplicationId 和工具 Schema；show 将保存的 assistantTools、nativeTools 与可读目录分别返回。complete 仅表示目录读取完整，不证明某个具体对话具有该工具。

默认工具与定义显式选用分别核对。assistantTools=[] 不会单独撤除 defaultAvailable=true 的工具；支持关闭配置的 Runtime 还须检查 disabledAssistantTools，命中名称后默认工具也不可调用。entries 限定 personal/application/employee 等适用入口；目标应用与来源应用分别受当前成员准入约束。通用目录不会赋予 CLI 某个 chat 的可信 currentAgentId、Task grant 或员工事项。

保留原错误和 catalogErrors：403 是当前身份未获相应读取或业务资格；tools.runtime_unsupported 是协议不兼容；tools.definition_changed、tools.target_changed 分别是合同或目标变化。模块裁剪要结合该实例已知的装配变更和前后目录差异核对，不能只凭空数组断言模块未激活。普通成员诊断失败时保留原身份，不换管理员执行原业务。

公共 create 工具另要求 calendarBasis 表示用户原要求：StatutoryWorkdays 或 Unclear 在保存前明确拒绝并要求澄清；Calendar 仅用于已确认的普通日期、间隔或星期规则。不得靠更换标签绕过未支持的法定工作日要求。此字段不是 CLI 手动 create 请求的新增字段。

## 五种编号分别保留

| 编号 | 来源与用途 |
|---|---|
| 对话 requestId | agent chat start/send 的 --request-id；关联原输入与 turn/end，未知后用原 sessionId 和此值 wait |
| tool callId | Runtime 原生工具调用编号；关联 tool/call 和 tool/result，不是安排编号 |
| 创建键 | create 工具正文返回的 requestId，由可信原生调用确定；直接 CLI create 使用请求 JSON 中的 requestId |
| scheduleId | 创建正文 data.id；show、enable、pause、history 定位原安排 |
| runId | history 或 run-once 返回的 id；run show/conversation 定位原运行，不等同于原生 sessionId |

初次工具 create 不传 creationRequestId。正文中的 requestId 才是该次创建的恢复键，不能用对话 requestId、callId 或新日期代替。恢复必须保留原规范 timing、时区及参数，不能重新计算“明天”。

~~~text
workforce schedule lookup --request-id <原创建键> --workforce <原宿主> --application-id <原应用> --profile <原成员> --json
workforce schedule show <原scheduleId> --workforce <原宿主> --application-id <原应用> --profile <原成员> --json
workforce schedule run show <原scheduleId> <原runId> --workforce <原宿主> --application-id <原应用> --profile <原成员> --json
~~~

lookup 未找到或读取失败不授权换键新建；写入未知后先核对原状态。enable 未知后读取原 revision 和状态，不重新启用后来已被人工暂停的安排。

## 手动执行一次

保存如下请求文件，保持同一次点击的 requestId 不变：

~~~json
{"requestId":"manual-fixed-click"}
~~~

~~~text
workforce schedule run-once <原scheduleId> --request-json <手动请求.json> --workforce <原宿主> --application-id <原应用> --profile <原执行人> --json
~~~

命令只调用原 run-once 业务入口，不启用安排，不消费 nextRunAt；Paused、Enabled、Completed 均可由原执行人按现有资格触发。回执含 trigger=Manual、原 scheduleId 与 runId。相同键沿后端幂等恢复原运行；存在未结束运行时，不同键返回 schedule.already_running。

回执未知时先读取已知原 runId、安排及历史；保留原点击键，不自动生成下一键或重放批次。查询 Failed 运行是一次成功读取，不能将它当作查询失败。手动成功不能替代真实到点验证；没有结束的原生 Session 也不能仅因本地等待超时就另建运行。

## 只读等待原运行

~~~text
workforce schedule run wait <原scheduleId> <原runId> --wait-timeout 120 --poll-interval 1 --workforce <原宿主> --application-id <原应用> --profile <原执行人> --json
~~~

默认总预算120秒、轮询间隔1秒，二者为正整数秒，最大86400秒。总预算从首次网络动作前开始，覆盖本人身份预检、请求和响应正文、轮询间隔；--timeout仍限制单个请求，较早截止者生效。命令只GET原运行，不写入、不读取其他运行来替代它。

终态回执的waitStatus=terminal，run保留原status、deadlineAt、Session及失败码。Succeeded、Failed、Cancelled、Skipped均是已成功读取的终态，退出码为0；businessSuccess=unverified表示仍需独立核对业务产物。Running继续观察。

本地预算结束返回schedule_wait_timeout，Ctrl+C返回schedule_wait_interrupted，保留原scheduleId/runId、宿主与profile、本地waitDeadlineAt、已读lastRun、serverCancelled=false和下一步。不会调用服务端取消、再建会话或再次手动执行；使用同一命令接续。404及权限失败保留原业务码，不把未读到当未执行，不自动换键。

## 判断 JSON 中的业务结果

chat 的 data.status=completed 仅表示原轮次结束。逐项读取 data.toolCalls 的 result.message.content 中原 text JSON，检查 create/enable/lookup 的 ok、outcome、requestId、data.id、status、revision 和 nextRunAt。原生工具 succeeded 仍可能承载 ok:false。

ok:false 且 outcome=rejected 是明确业务拒绝；outcome=unknown 保留原键进行只读回查；partial 保留已创建安排及失败原因。只有原安排回读为 Enabled 且具有 nextRunAt，才能声称后续定时执行已启用。运行 Succeeded 还须独立核对要求的文件、记录或投递后置结果。

agent run start 的受管 /xrain/runs 使用自身通用工具上下文，也可加载默认业务工具；它的 runId 与 scheduleId 不同。原协议没有客户端恢复键，CLI 不提供伪造的幂等参数；start 回执未知且没有 runId 时，明确保留定位缺口，不自动再次 start。已知 runId 使用 agent run show 只读观察。ephemeral generate 仅生成临时文本，不装业务工具、不保存安排。

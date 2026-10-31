# 智能体命令

所有命令接在 `node "<skill目录>/scripts/xrain-cli.mjs"` 后。先按 [连接与认证](configuration.md) 保存服务方提供的 Runtime 入口、登录并核对平台及 Runtime 的本人身份；以下示例省略共同的 `--profile <连接> --auth session --json`。Runtime 命令复用该 profile，也可用 `--runtime <Runtime origin>` 单次覆盖。所选平台凭据会发送到该地址，不能从平台地址推断它。

## 职责和顺序

Runtime 持有智能体定义、工作区和工具配置；XRain 持有个人订阅规则、申请、批准和应用选用。新建定义先保存为停用；完成模型、工作方式和有效工作区后再按明确要求启用。公开策略允许个人主动订阅，私有策略的申请需批准。个人资格和应用选用分别判断：应用使用按应用准入和业务权限，不要求个人订阅；管理权也不等于个人订阅。定义与订阅不创建 AI 员工账号。

先读可用选项和当前定义，按实际管理权限配置；再按用户要求分别配置个人订阅或应用选用。工具配置不会赋予业务数据权限，工作区属于 Runtime 所在机器。

## 查询和定义

```text
agent definition options
agent definition limits
agent definition list
agent definition show <agentId>
agent directory
agent directory --mine
agent directory --application-id <应用ID>
agent qualifications [--application-id <应用ID> | --personal]
agent use <agentId> [--application-id <应用ID> | --personal]
```

`directory` 汇合 Runtime 定义与平台资格，默认使用 profile 配置的应用上下文；`--personal` 单次选择个人上下文，`--mine` 始终仅列本人获批准的订阅。`qualifications` 和 `use` 只读取平台判断，不证明 Runtime 定义已启用或工作区可用，也不执行智能体。个人订阅命令始终以当前人为主体。

新版 `list` 返回不含完整工作要求的摘要，`show` 按 ID 读取单条定义。旧服务只在新读取接口返回 404 时使用原列表，鉴权失败、服务故障或无效响应不会降级。读取和导出已有定义不采用当前写入限额，也不再受通用 32 MiB 响应限制。

## 发起和继续对话

`agent chat` 使用 Runtime 的真实会话、所选定义及当前主体权限；工具可能读取或修改实际资料。按明确授权发送输入，验证时可使用不涉及业务写入的合成问题。应用入口使用 profile 配置的应用或显式 `--application-id`；已配置应用时可用 `--personal` 选择个人入口并遵循本人订阅规则。续聊、等待和回答待处理事项时使用原会话相同的 Runtime 和应用上下文。命令结果提供实际 Runtime 与 applicationId；切换 profile 后由使用者选回原目标或显式指定，不按名称猜测。

```text
agent chat start <agentId> --message-file <输入.txt>
agent chat send <sessionId> --message-file <输入.txt>
agent chat list
agent chat list --all
agent chat history <sessionId>
agent chat history <sessionId> --through-seq <cursor> --before-seq <nextBeforeSeq> --page-size 100
agent chat wait <sessionId> --request-id <原请求ID>
agent chat pending --session-id <sessionId>
agent chat respond <actionRef> --values-json <回答.json>
```

`--message-file -` 从标准输入读取 UTF-8 文本，也可用 `--message` 直接提供短输入。新建会话使用 `xrain-cli` 来源；默认列表只列该来源，`--all` 显示当前主体的其他来源。`start` 建立新会话并发送一条输入，`send` 继续准确指定的已有会话。命令在提交前输出 sessionId 和 requestId；也可通过 `--request-id` 显式指定本次输入的稳定 ID。

命令等待本次请求自己的 `turn/end`，默认最多 120 秒，可用 `--wait-timeout` 调整。该总预算在本地输入校验后、首次网络操作前开始，覆盖 `start` 的会话创建，以及流连接、输入提交回执和本轮结果跟随，不在各阶段重新计时。单次 HTTP 请求仍受 `--timeout` 约束。已经观察到同一 requestId、输入及本轮结束的完成事件时，可先于迟到的提交回执返回。返回 `completed` 和文本答复只证明该轮运行完成，不证明答复正确或业务写入成功；`toolCalls` 的状态反映 Runtime 工具回执。历史只展示可见用户、助手、工具及结束状态，`hasMore` 表示当前返回并非完整历史。

`wait` 在首屏缺少原请求或轮次起点时，会沿首屏固定的 cursor 自动补读较早历史，再按时间顺序关联原请求；分页计入同一等待预算。`history` 返回 cursor 和可选 nextBeforeSeq；有更早记录时，将它们分别传给 `--through-seq` 和 `--before-seq`，继续读取同一快照的前一页，页大小默认 100。旧 Runtime 未提供分页或返回重复、越界页时明确报错，保留原会话和请求，不重发输入。

`action_required` 会给出待处理问题或审批的 actionRef；不能自动批准。用户明确选择后可发送 `{"outcome":"allowed-once"}` 或 `{"outcome":"rejected"}`，问题按服务返回的 question ID 提供 `{"answers":[{"id":"<问题ID>","selected":["<选择>"],"custom":"<可选文字>"}]}`。响应有独立的 responseId，结果未知时先检查原事项；提交后使用原 sessionId/requestId 的 `wait` 读取该轮结果，不重发对话。超时只结束本地等待，不发出服务端取消请求，也不证明输入未接收。输入已尝试提交但未确认时返回 `outcome_unknown` 并保留原 ID；超时、断流、会话创建或输入结果未知先查 `list`、`history` 或 `wait`。历史分页导致无法确认时不能把旧回复当作新结果。

## 定义创建与修改

创建可提供 `--agent-id <稳定ID>`；省略时生成 ID 并在提交前写入 stderr。请保留此 ID，不按名称认领另一条定义。`--name` 给出名称，其他配置以 JSON 对象提供。下例的值须取自实际 `options`；工作要求可包含多行：

```json
{
  "instructions": "按用户要求整理资料。",
  "provider": "已有提供者",
  "model": "已有模型",
  "workspaceChange": { "operation": "bind", "workspaceId": "已有工作区ID", "agentPreset": "已有工作方式" },
  "nativeTools": []
}
```

```text
agent definition create --name <名称> --values-json <定义.json>
agent definition update <agentId> --expected-revision <读到的版本> --values-json <修改.json>
agent definition enable <agentId> --expected-revision <读到的版本>
agent definition disable <agentId> --expected-revision <读到的版本>
```

创建时名称也可放在 JSON 的 `name`，但不能同时使用 `--name`；无 JSON 可先创建空的停用定义。`update` 接收待修改字段，保留原定义的其他字段。每次更新或启停都必须提供实际读取的版本；冲突时重读比较，不自动改用新版本。更换目录或工作方式使用上述 `workspaceChange: {operation:"bind",...}`；`{operation:"clear"}` 仅能用于停用的定义。未改工作区时保留原绑定。原生工具和业务工具显式空数组表示清空，省略表示保留。

如果写入返回 `outcome_unknown`，用同一 Runtime 和 agentId `show`，对照修改及版本，再决定是否重试。不要仅凭名称新建，也不要自动重放。新建本身不运行模型。

直接选择已有目录使用 `create/update --workspace-path <Runtime机器上的绝对路径> --preset <已有工作方式>`，也可在 JSON 中提供 `workspaceChange: {operation:"direct",path:"...",agentPreset:"..."}`。CLI 同步对应目录字段并交 Runtime 核验，不创建文件夹或登记可选列表。原生工具的 `null` 表示恢复继承，与省略、空数组分别处理。

每次完整保存前读取 Runtime 当次限额，按 UTF-8 字节检查文件、stdin、内联 JSON 和合并后的完整请求。部分字段补丁很小也可能因原定义太大而被拒绝。支持轻量启停时只提交 ID、明确版本和状态；降低上限后仍可停用旧大定义。旧 Runtime 的启停沿用原完整保存合同，并明确提示能力差异。

## 定义文件交换

```text
agent definition export <agentId> --out <新文件.json>
agent definition import --file <定义文件.json>
agent definition import --file <定义文件.json> --agent-id <已有ID> --expected-revision <读到的版本>
```

文件与页面的 `xrain-workforce-agent-definition`、`version: 1` 格式相同。[完整合成样本](examples/definition-file-v1.json)包含模型、直接目录、继承工具、业务工具、推荐问题、业务操作、侧栏及录入字段；实际目录和业务引用须换成目标环境提供的值。它不是 `update` 的字段补丁，也不是 Runtime schema 3 存储文件。

导出排他创建文件，保留已有文件。导入支持 `--file -`，无需强制预览；不指定 ID 时创建停用定义，提交前输出生成 ID。指定已有 ID 时要求明确版本，保留目标启用状态；不会修改订阅、应用选用或员工关系。文件记录的启用状态不直接应用。

直接目录在保存时由 Runtime 核验。登记目录只有 ID、路径及工作方式在目标环境匹配时重新绑定，否则保留目标目录并报告警告。文件未提供目录且目标已启用时保留原目录；停用目标可以清除目录。工具继承恢复需 Runtime 声明支持；旧服务不支持时保留目标选择并警告。格式或保存校验失败不覆盖原定义，结果未知仍按原 ID 回读。

## 工作区与工具

```text
agent tool native --workspace-id <工作区ID> --preset <工作方式>
agent tool native --workspace-path <已有目录> --preset <工作方式>
agent tool business
agent workspace browse --values-json <目录查询.json>
agent workspace create --values-json <目录创建.json>
agent workspace register --values-json <工作区登记.json>
```

目录查询 JSON 为 `{"path":"<Runtime机器上的目录>"}`；创建为 `{"parent":"<已有父目录>","name":"<目录名>"}`；登记为 `{"path":"<已有目录>","name":"<显示名称>","agentPresets":["<可用工作方式>"]}`。目录和工作区写入需要用户明确要求及对应管理权；结果未知先检查原位置和登记，避免重复创建。

## 个人订阅与审批

```text
agent policy list
agent policy set <agentId> --visibility public
agent policy set <agentId> --visibility private
agent subscribe <agentId>
agent unsubscribe <agentId>
agent subscription list
agent subscription decide <申请ID> --decision approved
agent subscription decide <申请ID> --decision rejected
agent subscription decide <申请ID> --decision revoked
```

订阅以当前登录人为主体；私有申请可能返回 pending，不能当成已批准。审批需要对应权限和明确操作；取消只影响个人订阅，保留历史和应用选用。结果未知先查询资格或申请，不重复提交。

## 应用选用

```text
agent application list
agent application show <应用ID>
agent application set <应用ID> --values-json <完整选用.json>
```

读取后根据明确要求构造完整集合，例如 `{"bindings":[{"agentId":"<已有ID>"}],"defaultAgentId":"<已有ID>"}`。`set` 替换该应用的全部选用和默认项，不是追加；先保留仍需要的绑定。平台执行实际权限检查，结果未知先按原应用 ID 回读。

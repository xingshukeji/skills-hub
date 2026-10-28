# 命令与进程协议

单次调用可用 `deskpilot capabilities --format json`。涉及引用时保持一个 `deskpilot exec --stdin --format ndjson` 进程，stdin 每行一个 JSON；每个响应在 stdout 占一行，按 `id` 或 `request_id` 配对。输入 UTF-8，诊断不混入协议结果。

```json
{"id":"find","method":"windows.find","params":{"title_contains":"目标窗口"}}
```

响应结构为 `{"id":"find","request_id":"find","ok":true,"result":{...}}`；错误使用 `ok:false` 和 `error:{code,message,retryable,outcome}`。`outcome` 区分 `not_dispatched` 与 `unknown`。单行上限 8 MiB，批次上限 32 步，默认请求预算 30000ms，可用 `timeout_ms` 调整。

## 常用参数

| 方法 | 参数与结果 |
|---|---|
| `capabilities`、`schema`、`doctor` | 方法发现、引用要求、当前平台及能力诊断；不会安装依赖或运行场景 |
| `windows.list` / `windows.find` | `title_exact`、`title_contains`、`process_name`、`pid` 等；返回进程内 `window_id` |
| `windows.info` / `windows.activate` | `window_id` 或唯一窗口条件 |
| `observe` / `ui.tree` / `ui.find` / `ui.find_all` | 窗口条件、`name`/`name_contains`、`automation_id`、`control_type`；`depth`、`limit` 控制范围。返回 `observation_id` 和 `element_id` |
| `ui.get` / `ui.invoke` / `ui.click` / `ui.set_value` / `ui.select` | `element_id` + 对应 `observation_id`；set_value 提供字符串 `value`，select 可提供选项 `value` |
| `input.type` / `input.key` / `input.hotkey` | 窗口 + `text` 或 `keys` 字符串数组；按当前焦点输入，先核对焦点 |
| `input.click` / `input.double_click` / `input.right_click` / `input.scroll` | 窗口 + 当前 `observation_id` 或 `screenshot_id` + 窗口内 `x`,`y`；scroll 使用 `amount`，120 为一格，可设 `horizontal` |
| `screen.capture` / `screen.capture_window` | 窗口条件；可选绝对 `path`，其父目录须已存在；默认截图随会话清理 |
| `screen.read_text` | 窗口条件或当前 `screenshot_id`；可用截图内 `region` 限定区域，返回全图坐标的文本块、置信度和来源，`include_words` 不保证跨平台词框 |
| `messages.observe` | 上述参数 + `identity_region`,`content_region` 和 `expected_identity`；输出文字候选，不替调用方决策 |
| `wait.window` / `wait.element` | 窗口/元素条件 + `timeout_ms`、`poll_ms`；返回满足条件的当前观察 |
| `interaction.begin` / `interaction.status` / `interaction.end` | 保持一组操作和提示，结束恢复原前台；可设 `show_overlay`、`show_action_trace`、`restore_original_window` |
| `interaction.cancel` / `close` | 取消当前请求或关闭会话；取消可以在长请求执行期间并发写入 |

窗口条件必须唯一。`ui.find` 返回全部匹配，调用方自己检查 `count`；不得直接对不唯一结果取首项。ID 不能跨进程保存。动作使观察过期；窗口移动、改标题、身份变化也会使旧观察无效。

Windows 的 `window.activation` 提供当次前台核验依据；`ui.get` 返回非密码控件的 `value` 和 `has_keyboard_focus`，`observe` 不返回 value。`ui.set_value` 成功可带 `verification`；确认不了时只回读、不重新派发，返回 `VALUE_NOT_VERIFIED` 和 `outcome: unknown`。页面地址、深层文档和外来覆盖的核对方法见[桌面](desktop.md)。

## 短批次

`actions.batch` 和 `workflow.run` 接受 `steps`。每步 `id` 唯一，使用 `$ref` 引用较早步骤的结果，路径可含数组索引。

```json
{"id":"edit","method":"actions.batch","params":{"steps":[
  {"id":"find","method":"ui.find","params":{"title_exact":"已确认窗口","automation_id":"已观察到的唯一控件ID"}},
  {"id":"write","method":"ui.set_value","params":{"element_id":{"$ref":"find.result.elements[0].element_id"},"observation_id":{"$ref":"find.result.observation_id"},"value":"调用方指定正文"}},
  {"id":"read","method":"ui.find","params":{"title_exact":"已确认窗口","automation_id":"已观察到的唯一控件ID"}}
]}}
```

该例以唯一性已被此前观察确认作为前提。正文和 ID 均来自当前任务；实际执行前换成真实值。

批次逐步执行，首个错误后停止。`BATCH_STEP_FAILED` 的 details 返回已完成步骤和 cause_code；`BATCH_OUTCOME_UNKNOWN` 表示有动作可能已经发生。它们都不是事务回滚信号。核对 details 和应用状态后再决定下一步。取消也会拒绝取消前排队而尚未派发的请求；新收到的明确请求可以继续。

退出前写入 `{"id":"end","method":"close","params":{}}` 并关闭 stdin。浏览器连接会断开；用户浏览器和 profile 不因 close 被删除。

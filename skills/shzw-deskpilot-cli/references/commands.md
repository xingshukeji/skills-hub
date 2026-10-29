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
| `observe` / `ui.tree` / `ui.find` / `ui.find_all` | 窗口条件、`name`/`name_contains`、`automation_id`、`control_type`、控件 `class_name`；`depth`、`limit` 控制范围。返回 `observation_id` 和 `element_id` |
| `ui.get` / `ui.invoke` / `ui.click` / `ui.set_value` / `ui.select` | `element_id` + 对应 `observation_id`；set_value 提供字符串 `value`。Windows 文本模式回退的多行内容需按已确认的控件行为提供 `newline_strategy`；select 可提供选项 `value` |
| `input.type` / `input.key` / `input.hotkey` | 窗口 + `text` 或 `keys` 字符串数组；按当前焦点输入，先核对焦点 |
| `android.observe` | 已确认的本机模拟器窗口；可选 `adb_path`、`limit`。返回设备、当前访客控件与会话内引用；密码节点及其子节点不返回文字 |
| `android.click` / `android.set_value` | 当前 Android `observation_id` + `element_id`；点击只表示已派发，赋值替换非密码字段并回读确认。值目前限 128 个可打印 ASCII 字符 |
| `android.swipe` | 选中当前 Android 辅助树的可滚动节点，提供设备坐标 `start`、`end` 及可选 `duration_ms`；仅确认派发，需观察滚动后的页面 |
| `input.secret` | 已授权本机测试凭据输入，只接受本地 JSON 文件引用，不能放入批次；Windows 原生控件或 Android 密码控件使用各自的当前观察。完整前提见[桌面](desktop.md#已授权的本机测试凭据) |
| `input.click` / `input.double_click` / `input.right_click` / `input.scroll` | 窗口 + 当前 `observation_id` 或 `screenshot_id` + `x`,`y`；引用截图时使用图片内坐标，引用控件观察时使用窗口内坐标。scroll 使用 `amount`，120 为一格，可设 `horizontal` |
| `screen.capture` / `screen.capture_window` | 窗口条件；可选绝对 `path`，其父目录须已存在；默认截图随会话清理 |
| `screen.read_text` | 窗口条件或当前 `screenshot_id`；可用截图内 `region` 限定区域，返回全图坐标的文本块、置信度和来源，`include_words` 不保证跨平台词框 |
| `messages.observe` | 上述参数 + `identity_region`,`content_region` 和 `expected_identity`；输出文字候选，不替调用方决策 |
| `wait.window` / `wait.element` | 窗口/元素条件 + `timeout_ms`、`poll_ms`；返回满足条件的当前观察 |
| `interaction.begin` / `interaction.status` / `interaction.end` | 保持一组操作和提示，结束恢复原前台；可设 `show_overlay`、`show_action_trace`、`restore_original_window` |
| `interaction.cancel` / `close` | 取消当前请求或关闭会话；取消可以在长请求执行期间并发写入 |

窗口条件必须唯一。`ui.find` 只返回所搜索范围内的匹配；`truncated: true` 不能证明唯一或不存在，树搜索的深度也可能排除更深的控件。`require_unique: true` 在该范围内要求恰好一个匹配且未截断，否则返回 `ELEMENT_NOT_FOUND`、`ELEMENT_NOT_UNIQUE` 或 `UI_AUTOMATION_INCOMPLETE`；不能直接对不唯一或未完成的结果取首项。元素缺失时 `wait.element` 可等待，截断时不能将缺失误报为已消失。ID 不能跨进程保存。动作使观察过期；窗口移动、改标题、身份变化也会使旧观察无效。

`observe` 可设 `include_screenshot: true`，在同一响应返回控件树和可信截图，省去一次单独请求；默认仍只读取控件树。两者依次取得，不是原子快照，动态页面仍需确认当前状态。

`android.observe` 只连接与已选本机 Android Emulator 窗口的端口和 AVD 名称一致的本地设备。优先从该模拟器的 SDK 找 ADB，其次使用 SDK 环境变量或 PATH，也可提供绝对 `adb_path`；不安装工具、不重启或修改模拟器。返回的 `parent` 是当前数组中的父节点下标，`truncated: true` 不能证明控件不存在。动作前重新核对窗口、设备和目标；动作后引用失效。`android.set_value` 需要字段已获焦点，清除后写入一次，并对非密码值回读；不支持的字符在派发前拒绝。若操作结果未知，重新观察，不能重放整批。

`input.*` 的普通鼠标、按键、文字和滚轮操作，以及 `ui.click`、`ui.invoke`，只确认操作已派发，`verification.status` 为 `not_checked`；调用方须观察应用实际变化。滚轮位置应选在实际可滚动的区域，避免把嵌套列表与外层页面混淆。

Windows 已知准确 `automation_id` 时，`ui.find`、`ui.find_all` 或 `wait.element` 可设 `search_scope: "subtree"`，使用系统的整个控件子树精确查找。此模式不接受 `depth`，`limit` 限制该 ID 的匹配节点数而非遍历节点数，`depth` 和 `parent` 不提供；其他筛选条件仍在匹配结果上应用。结果截断或系统无法完整读取时不能证明唯一；不支持此模式的平台返回 `UNSUPPORTED_PLATFORM`。普通 `tree` 范围及其深度、节点上限保持原行为。

`ui.find`、`ui.find_all` 和 `wait.element` 中的 `class_name` 匹配控件类；如需同时限定窗口类，使用 `window_class_name`。`windows.find` 中的 `class_name` 仍匹配窗口类。

Windows 的 `window.activation` 提供当次前台核验依据；`ui.get` 返回非密码控件的 `value`、`value_source` 和 `has_keyboard_focus`，`observe` 不返回 value。`ui.set_value` 成功可带 `verification`；确认不了时只回读、不重新派发，返回 `VALUE_NOT_VERIFIED` 和 `outcome: unknown`。窗口专属截图标明 `capture_scope`、覆盖窗口与未合成的独立窗口；输入位置仍由系统实际命中结果核对。页面地址、深层文档和外来覆盖的核对方法见[桌面](desktop.md)。

## 短批次

`actions.batch` 和 `workflow.run` 接受 `steps`。每步 `id` 唯一，使用 `$ref` 引用较早步骤的结果，路径可含数组索引。

```json
{"id":"edit","method":"actions.batch","params":{"steps":[
  {"id":"find","method":"ui.find","params":{"title_exact":"已确认窗口","automation_id":"已观察到的唯一控件ID","require_unique":true}},
  {"id":"write","method":"ui.set_value","params":{"element_id":{"$ref":"find.result.elements[0].element_id"},"observation_id":{"$ref":"find.result.observation_id"},"value":"调用方指定正文"}},
  {"id":"read","method":"ui.find","params":{"title_exact":"已确认窗口","automation_id":"已观察到的唯一控件ID"}}
]}}
```

该例以唯一性已被此前观察确认作为前提。正文和 ID 均来自当前任务；实际执行前换成真实值。

批次逐步执行，首个错误后停止。`BATCH_STEP_FAILED` 的 details 返回已完成步骤和 cause_code；`BATCH_OUTCOME_UNKNOWN` 表示有动作可能已经发生。它们都不是事务回滚信号。核对 details 和应用状态后再决定下一步。取消也会拒绝取消前排队而尚未派发的请求；新收到的明确请求可以继续。

退出前写入 `{"id":"end","method":"close","params":{}}` 并关闭 stdin。浏览器连接会断开；用户浏览器和 profile 不因 close 被删除。

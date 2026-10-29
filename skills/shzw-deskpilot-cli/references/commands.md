# 命令与进程协议

需要查参数或组织短批次时使用。正常操作顺序分别见[桌面](desktop.md)、[Android](android.md)和[浏览器](browser.md)。

## 请求与响应

单次能力查询可用 `deskpilot capabilities --format json`。涉及引用时保持一个 `deskpilot exec --stdin --format ndjson` 进程，UTF-8 stdin 每行一个 JSON，stdout 每行一个响应，诊断不混入结果。

```json
{"id":"find","method":"windows.find","params":{"title_contains":"目标窗口"}}
```

成功为 `{"id":"find","request_id":"find","ok":true,"result":{...}}`，错误为 `ok:false` 和 `error:{code,message,retryable,outcome}`。outcome 区分 not_dispatched 与 unknown。单行上限 8 MiB，默认请求预算 30000ms，可用 timeout_ms 调整。schema 可按 method 查询修改性质和引用要求，目前不是完整参数定义。

通过命令执行工具交互时，响应可能分多次返回。收齐与本次 id 对应的完整 JSON 后再解析；工具的展示长度限制不能当作协议边界。不要对被截断的 JSON 反复猜结构、提取引用或重发操作。需要包装交互时，在包装层保留原始 stdout，并只输出本次判断需要的内容。

## 记录与接续

仅在任务要求证据或需要跨端、长流程接续时使用。复用任务指定的报告或临时记录，不另建业务台账。

1. 开始时写入原始任务、目标环境、完成条件和输出位置。阶段结束补充已确认结果、剩余动作、临时改动及恢复状态。
2. 将请求和完整响应按 id、时间落到本机。首个响应后核对文件确实包含该 id 和响应正文；启动终端转录不证明原生进程输出已被记录。
3. 记录原始回执的位置，向模型输出精简视图；保留错误、outcome、数量、truncated 及操作需要的状态。首次观察可只展示具名或可操作的可见控件，必要时再展开局部。
4. 上下文接近上限时先更新记录。续跑先读本任务记录，再观察当前现场；复用记录不代表旧元素引用仍有效。未完成项和未恢复状态不得在压缩后消失。

## 方法速查

| 方法 | 参数与结果 |
|---|---|
| capabilities / schema / doctor | 能力发现、引用要求、环境诊断，不安装或执行场景 |
| windows.list / windows.find | title_exact、title_contains、process_name、pid、窗口 class_name，返回 window_id |
| windows.info / windows.activate | window_id 或唯一窗口条件 |
| observe / ui.tree / ui.find / ui.find_all | 窗口条件、name/name_contains、automation_id、control_type、控件 class_name；窗口类另用 window_class_name；depth、limit 控制范围，返回 observation_id 和 element_id |
| ui.get / ui.invoke / ui.click / ui.set_value / ui.select | element_id + observation_id；set_value 加字符串 value，多行文本回退可需 newline_strategy；select 可加选项 value |
| input.type / input.key / input.hotkey | 窗口 + text 或 keys 字符串数组，作用于当前焦点 |
| android.observe / android.click / android.set_value / android.swipe | 设备绑定、引用、输入限制及手势参数见 [Android](android.md) |
| input.secret | 仅受管 JSON 引用，不得批次，见[测试凭据](credentials.md) |
| input.click / input.double_click / input.right_click / input.scroll | 窗口 + 当前 observation_id 或 screenshot_id + x、y，坐标系见[截图](screen.md)；scroll 加 amount，可选 horizontal |
| screen.capture / screen.capture_window / screen.read_text / messages.observe | 路径、区域和文字候选见[截图与 OCR](screen.md) |
| wait.window / wait.element | 窗口/元素条件 + timeout_ms、poll_ms，返回满足条件的当前观察 |
| interaction.begin / interaction.status / interaction.end | 提示和原前台恢复，可设 show_overlay、show_action_trace、restore_original_window |
| interaction.cancel / close | 取消或关闭，取消可在长请求期间并发写入 |
| chrome.* | 连接、选择器、输入和等待见[浏览器](browser.md) |

Windows 的状态提示可用右侧关闭按钮收起；这只关闭提示和动作边框，不会取消当前操作。同一个进程内提示不会自动重新出现，新进程可再次显示。若调用方明确要求 `overlay_required: true`，用户关闭提示后的后续操作会报告 `OVERLAY_UNAVAILABLE`，避免将未显示的提示当作已显示。

查找 require_unique: true 要求所搜索范围只有一个匹配且未截断，否则返回 ELEMENT_NOT_FOUND、ELEMENT_NOT_UNIQUE 或 UI_AUTOMATION_INCOMPLETE。树深度也可能排除深层控件。Windows 已知准确 automation_id 时可用 search_scope: subtree，见[桌面](desktop.md)。

## 短批次

actions.batch 和 workflow.run 接收最多 32 个 steps。每步 id 唯一，$ref 引用此前结果，路径可含数组索引。只批量执行已明确动作，根据响应才能决定的业务分支留到下一次交互。

```json
{"id":"edit","method":"actions.batch","params":{"steps":[
  {"id":"find","method":"ui.find","params":{"title_exact":"已确认窗口","automation_id":"已观察的控件ID","require_unique":true}},
  {"id":"write","method":"ui.set_value","params":{"element_id":{"$ref":"find.result.elements[0].element_id"},"observation_id":{"$ref":"find.result.observation_id"},"value":"任务要求的内容"}},
  {"id":"read","method":"ui.find","params":{"title_exact":"已确认窗口","automation_id":"已观察的控件ID","require_unique":true}}
]}}
```

示例需替换为当前对象和正文；最后的 find 只产生新引用，字段值另用 ui.get。动作使旧观察失效，批次也须引用刚产生的有效结果。

首个错误后停止。BATCH_STEP_FAILED 的 details 提供已完成步骤和 cause_code，BATCH_OUTCOME_UNKNOWN 表示可能生效，不能当作事务回滚。核对状态再继续，见[故障恢复](recovery.md)。取消拒绝尚未派发的排队请求，新收到的明确请求可继续。

退出前发送 `{"id":"end","method":"close","params":{}}` 并关闭 stdin。连接断开不删除用户浏览器或 profile。

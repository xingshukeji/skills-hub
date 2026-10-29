# 桌面客户端操作

用于原生桌面客户端和 Electron。模拟器内部应用直接读 [Android](android.md)；网页通道读[浏览器](browser.md)。只有截图、凭据或具体错误出现时才追加对应专题。

## 正常操作顺序

使用安装返回的绝对命令路径启动一个 `exec --stdin --format ndjson` 进程；每行一个 JSON 请求，按响应的 id 配对。不要为每个动作另开进程。

1. `windows.find` 用标题、进程名或 PID 找到唯一窗口，保留本进程的 window_id。核对当前内容；标题不能证明实际页面、租户或登录身份。
2. `observe` 读取控件，以实际名字、类型或 automation_id 定位。首次观察在执行层提取当前可见的具名或可操作控件；不要把完整 UIA 树原样交给模型。只需某个控件时用 `ui.find` 限定范围。记录和输出方式见[协议](commands.md#记录与接续)。
3. 对当前非密码字段，用 `ui.get` 读取值，再用 `ui.set_value` 替换。observe 和 ui.find 不返回输入值，缺少 value 不能解释成空字段。
4. 动作后重新查找。输入以字段回读为证；点击保存后核对应用反馈，必要时重新打开记录确认。登录后在同一窗口核对业务导航、身份和租户。

| 操作 | 本步必要参数 |
|---|---|
| `windows.find` | title_exact / title_contains、process_name、pid，按实际线索组合 |
| `observe` | window_id；可选 depth、limit |
| `ui.find` | window_id 和已观察的 name、automation_id、control_type 等；需唯一时 require_unique: true |
| `ui.get` / `ui.click` / `ui.invoke` | 当前 element_id 与对应 observation_id |
| `ui.set_value` | 同上，另加字符串 value |

先读取字段，再决定是否修改。以下引用需替换为当前响应中的真实值：

```json
{"id":"read","method":"ui.get","params":{"element_id":"当前元素ID","observation_id":"当前观察ID"}}
{"id":"write","method":"ui.set_value","params":{"element_id":"当前元素ID","observation_id":"当前观察ID","value":"任务要求的内容"}}
```

写入后以上观察失效，重新 ui.find。字段回读不证明应用已保存。ui.click、ui.invoke 和普通 input.* 成功只表示派发，返回 verification.status: not_checked。

## Windows 与 Electron 的必要差异

**页面身份。** Electron 文档可能藏在深层容器中。只看到 WebView 时，可对同一窗口增加 depth，例如 16，默认是 8。truncated 只表示节点数达到 limit，不保证已遍历更深子树。

确认页面地址时，用 ui.find 查 control_type: document，对候选分别 ui.get。支持 ValuePattern 的文档以 element.value 提供地址；Chromium 常见 automation_id 为 RootWebArea。结合地址、位置/可见性和内容确认，不能取第一个文档节点。未暴露地址则保留未知，可用应用已有地址入口或已授权的 Chrome 连接；不为现有客户端另开调试入口。

**准确定位。** 已观察到准确 automation_id 时，可设 ui.find.search_scope: subtree 搜索整个窗口子树。该模式不接受 depth，limit 限制匹配数，depth/parent 不提供。截断或读取不完整不能证明唯一；其他平台用普通树搜索。class_name 匹配控件类，同时限定窗口类时用 window_class_name。

**输入方式。** ui.set_value 优先语义赋值，只派发一次并有界回读。赋值模式在派发前不可用、但控件提供可编辑文本模式时，工具确认非密码控件及焦点，再替换并回读，verification.method 为 uia_text_keyboard；ui.get.element.value_source 说明值来源。

文本模式多行输入可能返回 TEXT_INPUT_STRATEGY_REQUIRED，此时尚未写入。先确认控件怎样插入换行，再显式选 newline_strategy: unicode / enter / shift_enter；Enter 可能提交，不能猜测。VALUE_NOT_VERIFIED 或 outcome: unknown 按[输入恢复](recovery.md#输入未确认或结果未知)核对，工具不会在已尝试赋值后自动键盘重发。

需要键盘操作时用 input.type、input.key 或 input.hotkey：点击后重新定位，Windows 可用 ui.get.element.has_keyboard_focus 确认焦点。按键使用 keys 字符串数组；MOD/PRIMARY 在 macOS 是 Command，在 Windows/Linux 是 Ctrl。

控件信息不足再读[截图与 OCR](screen.md)。激活失败、旧引用或遮挡见[故障恢复](recovery.md)；密码登录见[测试凭据](credentials.md)。

# Chrome 页面

Chrome/CDP 使用 Python 标准库，优先于网页坐标操作。连接已有调试入口用 `chrome.attach` 或 `chrome.ensure` 的 `endpoint`；新建专用 profile 用 `chrome.ensure` 的绝对 `profile_dir` 和目标 `url`。工具查找机器现有 Chrome/Chromium，也接受 `executable`。

Windows 在常规环境路径之外也检查已注册的 Chrome/Edge 安装位置；仍找不到时，可在核实可执行文件后显式传入 `executable`。新建页面的 `chrome.ensure` 可能先返回 `about:blank` 或加载中状态：用 `chrome.wait` 等待目标地址和实际页面元素，再执行操作。

不要把普通 Chrome 主 profile 改成调试 profile。专用 profile 的认证和业务资料由用户拥有；工具退出不会删除它。已指定 endpoint 但不可连接时返回错误，不另启一个浏览器假装恢复。没有找到现成目标时 ensure 可新建页面；attach 只连接指定页面。

| 方法 | 参数 |
|---|---|
| `chrome.targets` | `endpoint`；返回当前可连接页面 |
| `chrome.attach` / `chrome.ensure` | `target_id` 或唯一 `url`/`url_contains`/`title_contains`，以及 endpoint 或 profile_dir；结果包含 target_id |
| `chrome.navigate` | `url`；可用 `ready_selector`、`ready_expression`、`wait_until` 和预算等待 |
| `chrome.query` | `selector`、`limit`、`max_text`、`attributes`；只读取指定范围，密码值省略 |
| `chrome.fill` | 唯一可见可编辑 `selector` 和字符串 `value`，支持中文并触发输入事件 |
| `chrome.select` | select 的唯一 `selector` 与 `value` 或 `values` |
| `chrome.click` | 唯一可见可操作 `selector` |
| `chrome.evaluate` | `expression`；只读表达式明确传 `read_only:true`；工具执行调用方提供的代码，不替调用方生成业务意图 |
| `chrome.wait` | selector + `state`（visible/hidden/attached/detached），或 `predicate`，或 ready_expression；返回实际就绪信号 |

选择器不唯一时返回 `CHROME_TARGET_AMBIGUOUS`，不点击首项。页面密码控件返回 `SENSITIVE_INPUT_BLOCKED`，交由用户完成。页面含密码框仅作为可见状态信息，不把整个页面推断成必须登录。

`chrome.click` 使用鼠标事件；页面处于隐藏状态时返回 `CHROME_PAGE_NOT_VISIBLE`，不声称已点击。先核对正确浏览器和标签是否可见，再决定如何恢复；不要把协议接收事件当作业务动作成功。

点击返回 `CHROME_TARGET_OCCLUDED` 且 `outcome: not_dispatched` 时，先观察页面上的登录提示或广告；能安全关闭的提示可关闭，再等待遮挡消失后重试该未派发动作。页面跳转等待超时也先检查当前地址和界面，判断是否出现拦截或仍在加载；不能因为点击已派发就声称目标页面已打开。

语义等待例子：

```json
{"id":"saved","method":"chrome.wait","params":{"timeout_ms":10000,"predicate":{"type":"element","selector":"#result","text":{"equals":"实际预期结果"}}}}
```

页面跳转时，结果控件也可能已经存在于旧页面。可用 `predicate` 的 `type: "all"` 同时等待 `type: "page"` 的目标 `url` 和 `type: "element"` 的目标控件，再继续下一步。

`wait_until:network_idle` 以当前页面网络活动稳定判断，可设 `stable_ms`；持续轮询或流式连接页面宜改用明确的页面结果。`ready_expression` 只表示表达式为 true，不代表按钮产生了业务结果。

断连后重新查询 targets 并核对当前页面。派发后的超时或断连可能产生 `outcome:unknown`，先读取实际结果，不能盲点重试。未发出的请求和已发出但结果未知的请求必须区分。

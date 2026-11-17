# 微信开发者工具联调

## 打开实际项目

1. 从项目配置确认绝对项目路径、`compileType`、AppID、源码根和基础库。按 Runbook 生成本机覆盖，确认实际宿主响应。复用已有项目、开发者登录和服务端口。
2. 运行安装包提供的 `wechatide --help`，确认内置 Skills 路径。Windows PATH 未生效时可直接调用安装目录中的 `wechatide.cmd`。读取随安装版本提供的根 `SKILL.md` 及所需场景，按其中约定取得版本字段。网页示例与当前安装包的工具名、参数及状态字段可能不同。先实测已安装版本，确有缺项时查官方支持版本和下载说明。
3. 在会话开始读取工具登录与技能版本状态。按当前返回区分开发者账号过期、项目 AppID 权限、宿主联通及业务账号权限。当前 IDE 的 Skill/CLI 参数从该命令帮助读取，MCP 参数从 `tools/list` 的 `inputSchema` 读取。已打开且当前原生页可读时复用窗口。要开窗时用当前目录提供的打开项目工具。

## 官方 MCP 接入

- 在开发者工具「设置 → 安全」检查服务端口和显示的端口号。复用客户端已有的可信配置；需要新连接时用「复制 MCP 配置」。Windows 实测生成的 stdio 配置以 `wechatide mcp` 启动，并使用 `--token=<值>`。官方文档也展示分开的 `--token` 参数。沿实际复制格式接入当前客户端的受保护配置。
- 当前 MCP 客户端无法动态注册时，可用同一 IDE 已公开的回环 HTTP 入口 `http://127.0.0.1:<服务端口>/mcp`，用 `Authorization: Bearer <MCP Token>`。发送 JSON-RPC `initialize`，用稳定的真实 `clientInfo.name`，协商协议版本后发送 `notifications/initialized`，再读取 `tools/list` 和调用 `tools/call`。HTTP `Accept` 同时声明 `application/json, text/event-stream`。服务器返回会话 ID 时后续沿用；按响应类型读 JSON 或事件流中的对应请求回执。
- MCP Token、可选 CLI 访问令牌、首次客户端授权和微信开发者账号登录各有用途。HTTP 401 查当前复制的 MCP 配置。HTTP 403 带 `Client authorization pending` 时观察 IDE 中相同客户端名称的确认窗口，按现有授权及界面要求完成，接着用原名称重试握手。扫码、设备确认和外部写入沿官方提示及项目授权处理。工具返回 `pending + taskId` 时保留原任务并按该版本的交互规则复查结果。
- Token 留在获准的客户端秘密配置或本机进程内。读取复制内容时只输出可用状态。调试期间选择本机回环入口，沿用其他敏感开关的既有设置。

## 交互与取证

| 本步目标 | 当前工具和后置条件 |
|---|---|
| 确认编译和打开页面 | 当前版本的 WXML/WXSS 编译工具提供对应文件的结果。触发刷新后另读运行页、渲染内容和相关日志。 |
| 点击、搜索、填表 | 先读 `automation_runtime_info` 中的活动页，结合对应 WXML 或 `automation_page_action` 查询定位。已验证版本用 `automation_element_action` 派发真实事件。用当前页面路由、对齐业务 ID 的唯一元素或字段值等后置条件等待。导航后重新取得页面和元素。 |
| 处理自定义组件 | 查询返回空时，用 `simulator_screenshot` 核对当前 IDE 模拟器实际渲染。已见铵帮编辑页的备注 textarea 可见而页面级查询为空。用 DeskPilot 在同一窗口定位并输入，随后读业务表单值确认，再走原保存入口和重新读取。用调试器改数据或重放 HTTP 时只记录诊断结果，以界面事件和业务回读验证输入交互。 |
| 确认请求与错误 | 在触发问题的同一项目与运行实例读取 Console / Network，用有限筛选定位端点、状态或错误。缓冲区无匹配时，结合受影响页的反馈和同身份宿主回读；只读必要数据并脱敏。 |
| 核验前后台 | 先留一段未发送测试草稿。已验证版本点击右上角胶囊的退出按钮会出现返回小程序的场景列表。选择适用场景返回，读同一会话 ID、历史和草稿。工具栏的停止控件会终止模拟器，重新编译后的打开属于冷启动。 |
| 截图 | 使用当前安装版的模拟器截图工具，把图片写到源码监听范围以外。验证截图页与对应业务 ID，再保存可交付证据。桌面截图须先核对窗口归属和画面可信状态。 |

### 官方 Automator SDK

需要重复执行复杂流程、持续等候业务事件或当前官方 MCP 能力缺项时，可复用项目已有的 `miniprogram-automator`。先查当前官方 CLI 帮助。Windows 上验证过的入口是安装目录的 `cli.bat auto --project <绝对目录> --auto-port <空闲端口> --port <当前选定服务端口> --trust-project`，信任只用于已核对且获准的本机目录。端口按当前安装与机器状态选择。SDK 通过该次返回的本机 WebSocket 连接，读取 `currentPage()` 证明就绪。

已有可用 WebSocket 时直接复用。若 CLI 提示成功但 WebSocket 未监听，检查服务端口、项目模式及已有窗口。开发窗口确认可关闭时，先正常退出再按 `auto` 启动一次。不要反复开窗或对其他项目强制退出。SDK 引用按活动页面重新获取，结束时用 `disconnect()` 释放连接。MCP 与 SDK 是否观察到同一实例，用实际项目、当前页及业务状态核对；各自的引用、日志缓冲和上下文不能假定通用。

[官方开发者工具 Skills](https://developers.weixin.qq.com/miniprogram/dev/devtools/Skills.html) · [官方 CLI](https://developers.weixin.qq.com/miniprogram/dev/devtools/cli.html) · [官方自动化文档](https://developers.weixin.qq.com/miniprogram/dev/devtools/auto/quick-start.html) · [小程序运行机制](https://developers.weixin.qq.com/miniprogram/dev/framework/runtime/operating-mechanism.html)

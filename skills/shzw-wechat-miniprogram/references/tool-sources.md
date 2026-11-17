# 小程序工具资料与取舍

| 来源 | 适用点及平台取舍 |
|---|---|
| [微信开发者工具 Skills](https://developers.weixin.qq.com/miniprogram/dev/devtools/Skills.html)及安装包内置 Skills | 用同一安装版提供的 MCP、CLI 帮助与 schema 完成项目管理、编译、页面级交互、截图和日志。官方网页与已安装版本有命名差异。Windows Stable 2.02.2609250 内置 Skills 0.3.11 实测完成 MCP 握手、当前页读取、WXML 编译、搜索、打开详情、保存及重新读取。 |
| [腾讯云 CloudBase 小程序 Skill](https://github.com/TencentCloudBase/skills/blob/main/skills/miniprogram-development/SKILL.md)与[两类 MCP 说明](https://github.com/TencentCloudBase/skills/blob/main/skills/miniprogram-development/references/wxide-vs-cloudbase-mcp.md) | 借鉴 IDE 开发和云资源的分工。DevTools MCP 负责本机 IDE。CloudBase MCP 按应用实际采用的云资源启用。进入铵帮现有顾客接待流程时沿 Workforce 与 XRain 的身份和数据入口。 |
| [官方 Automator](https://developers.weixin.qq.com/miniprogram/dev/devtools/auto/quick-start.html)与[自定义组件测试工具](https://github.com/wechat-miniprogram/miniprogram-simulate) | 前者连接 IDE 自动化 WebSocket，用于可重复的原生页面操作。后者适合本地 WXML 和组件检查。实际宿主、租户权限与写入结果通过原生运行和真实服务取证。 |
| [Sumkor 微信开发者工具 Skill](https://github.com/Sumkor/wechat-devtools)与[官方 toolCall 的使用经验](https://github.com/Sumkor/wechat-devtools/blob/main/wechat-devtools/references/official-toolcall.md) | 借鉴按窗口、项目与运行实例验证附着的做法，以及对元素、请求和端口状态分别查证。复杂 H5 或网络排查需要额外通道时先确认目标归属与官方能力，CDP 按需使用。 |
| [金数据 Agent Miniprogram](https://github.com/jinshuju/agent-miniprogram/blob/main/skills/agent-miniprogram/SKILL.md) | 借鉴先观察 WXML 快照、按本次引用操作、再观察结果，以及裁切记录用于重复验证的做法。其 daemon、快照引用和录制文件属于该工具。本技能沿已有官方 MCP、Automator 与 DeskPilot 交付。 |

铵帮实测中，微信开发者工具 MCP 能读取顾客编辑页数据，也能派发保存点击，页面级选择器没有返回自定义组件里的备注输入框。使用 DeskPilot 在同一模拟器填入测试备注，再通过 MCP 核对字段、保存、离开和重开原顾客，完成该业务验证。这一结果适用于实测页面与安装版本，其他组件先观察实际可见性。

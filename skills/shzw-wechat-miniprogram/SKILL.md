---
name: shzw-wechat-miniprogram
description: 开发、修复或联调原生微信小程序。适用于微信开发者工具导入编译、官方 Skills 和 MCP 接入、模拟器点击输入与取证、真机调试准备，以及铵帮顾客登记、资料编辑、接待对话和恢复。沿原小程序接入 XRain 与 Workforce，核对实际身份、权限和持久结果。普通 Web、React Native、独立系统测试及发布交付沿各自任务入口。
metadata:
  maintainer: 苏州苏宏助为智能科技有限公司
  source: https://github.com/xingshukeji/skills-hub/blob/main/skills/shzw-wechat-miniprogram/SKILL.md
---

# 微信小程序开发与联调

从责任项目的入口、Runbook 和原生项目配置确认实际源码根、AppID、宿主、测试身份和本次动作。铵帮的原生工程在 `clients/miniprogram/`，在默认 Workforce 宿主中复用登录、租户、顾客记录与接待 Runtime。已有业务流程按[平台接入与验证](references/platform-integration.md)执行。

## 开发与验证

1. 用当前 Local checkout 和项目生成的本机配置联调。遇到配置、夹具、选择器或自动化入口问题，先核对当前文件与消费者，保留其他会话的编辑，在授权范围内做最小可逆调整并重新观察。验收指定候选时单独绑定该候选及其构建证据。
2. 执行项目声明的源码、WXML 和定向测试。打开实际小程序，用[微信开发者工具](references/devtools.md)核对当前页面。优先复用官方 MCP 或内置 Skills 已支持的操作。复杂重复流程可用官方 Automator SDK 编排。桌面设置、原生弹窗或选择器看不到的控件，用获准的 DeskPilot 操作当前可信画面。
3. 从用户入口触发真实事件，再读目标页面、记录、会话或回执。编译结果、工具操作响应、平台写入、助手回复和真机行为分别由对应证据支持。结果未知时先读回原 ID 和当前页面，再决定下一步。恢复、重复提交、退出或权限拒绝等分支按变更实际影响覆盖。
4. 把只含必要字段的运行证据和截图放在项目约定的本机目录，避开 IDE 监听的源码根。记录当前项目与宿主、实际身份与租户、工具入口、动作和业务后置条件。预览、上传、发布与外部配置沿项目现有权限和交付入口执行。

## 按需读取

- [微信开发者工具](references/devtools.md)用于 MCP 接入、页面交互、编译、截图和故障恢复。
- [平台接入与验证](references/platform-integration.md)用于铵帮业务闭环、身份与真机边界。
- [工具资料与取舍](references/tool-sources.md)用于复核官方版本差异、开源方案和选型依据。

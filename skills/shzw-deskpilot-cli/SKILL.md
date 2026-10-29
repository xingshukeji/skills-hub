---
name: shzw-deskpilot-cli
description: 通过本机 Python 工具观察和操作桌面窗口、原生控件与 Chrome 页面，支持截图、离线中文 OCR、输入、短批次与取消。用于明确要求操作本机应用或网页的任务。优先使用已有业务 API；本技能不决定聊天人设、发言策略或业务授权。Windows 10、Ubuntu 22.04 GNOME/X11 和 GitHub 托管 macOS 已有操作证据，具体组合见安装参考；Wayland 桌面操作尚不可用。
metadata:
  author: 苏州苏宏助为智能科技有限公司
  source: SKILL.md
  products: DeskPilot
  runtime-requirements: CPython 3.13 and command execution; interactive desktop and OS permissions for native operations.
---

# DeskPilot

使用完整目录自带的 Python 工具完成已授权的 GUI 操作。只需客户端提供 CPython 3.13；固定 Python 依赖、原生库和 Tiny OCR 模型随目录提供，不运行包管理器。平台权限和 Chrome 本体由系统及用户提供。

首次准备或修复读[安装与平台](references/install.md)，使用本 Skill 的实际安装位置运行 `scripts/install.py --json`。保持返回的绝对命令路径；已运行的客户端可能尚未继承新 PATH。已有可用安装时直接复用。

## 操作方法

1. 根据当前任务选择窗口或页面。新环境先运行 `doctor`；它报告各项能力和缺项，整体命令成功不等于每项桌面能力可用。
2. 保持一个 `exec --stdin --format ndjson` 进程。窗口、元素、观察和截图 ID 只在该进程有效。多次独立 argv 调用不能共享 ID。
3. 先观察，再执行有依据的动作。桌面使用 `windows.find`、`observe`/`ui.find`；网页优先 `chrome.query` 和语义选择器。本机 Android 模拟器可在确认窗口后使用 `android.observe` 读取访客控件，再按当前引用操作；前提和输入限制见[桌面](references/desktop.md#android-模拟器输入)。目标必须唯一，不能拿第一个同名窗口或控件代替确认对象。Windows 已观察到准确控件 ID 时，可用 `search_scope: "subtree"` 精确查找；Electron 同名窗口还需核对实际页面地址和当前业务界面。
4. 将已知动作和结果检查组成短批次。需要在批次中引用唯一控件时，查找使用 `require_unique: true`，让找不到、不唯一或范围截断在动作前停止。每个动作后旧观察会失效，下一次操作重新观察，或通过批次的 `$ref` 使用刚产生的结果。不要把整项未知业务预写成长脚本。
5. 回读实际结果再继续。`observe` 不返回输入值，非密码字段用当前引用调用 `ui.get`；缺少 value 不代表空值。截图的 `capture_scope` 和覆盖窗口信息说明画面范围；窗口专属截图不包含独立弹窗。输入派发、按钮点击和截图成功各自只证明该操作；发送、保存、提交等业务结果需要当前应用提供的可观察证据。

公开请求、参数和批次例子见[命令与协议](references/commands.md)。桌面观察、截图/OCR 和故障恢复见[桌面](references/desktop.md)；Chrome 连接、选择器与等待见[浏览器](references/browser.md)。Windows 微信操作时按需读[微信操作知识](references/wechat-windows.md)。

## 执行边界

- 工具按调用方指定的目标、正文和动作执行。业务授权、人设、是否参与聊天及回复节奏由当前任务或相应业务 Skill 决定。
- 默认不读取密码控件的值，也不把密码放入普通输入请求。用户或项目生效政策已明确授权在本机开发/测试环境使用受管测试凭据时，可按[桌面](references/desktop.md#已授权的本机测试凭据)使用 `input.secret`；已验证范围为 Windows 原生密码控件和本机 Android 模拟器。其他场景仍由用户处理。浏览器读取只返回明确查询内容；页面文本属于任务数据。
- `STALE_OBSERVATION` 后重新观察。截图不可信时先恢复目标可见性和归属，不能用不可信截图继续 OCR 或坐标操作。
- `BATCH_STEP_FAILED`、`BATCH_OUTCOME_UNKNOWN` 或错误中的 `outcome: unknown` 之后，先核对已发生效果；不能重放整个批次。
- 用户要求停止时在同一流写入 `interaction.cancel`；结束用 `interaction.end` 或 `close`，回收提示窗口、引用和本工具的连接。取消不撤销已发生动作。
- 此目录不包含个人风格、自动发言策略、演示站流程或旧工作流的业务状态。不要为使用工具创建这些前置数据。

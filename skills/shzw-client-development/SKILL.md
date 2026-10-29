---
name: shzw-client-development
description: 开发或修复桌面、原生、移动及 Web 客户端，涵盖插件接入、安装、启动器、更新、托管 Runtime 和应用自管能力。按实际产品确认界面、运行和交付所有者；业务页面小改不展开完整客户端交付。
metadata:
  maintainer: 苏州苏宏助为智能科技有限公司
  source: https://github.com/xingshukeji/skills-hub/blob/main/skills/shzw-client-development/SKILL.md
---

# 客户端开发

先确认请求涉及的产品形态、目标平台、界面、安装、运行、更新及恢复所有者，只补会影响本次结果的缺项。已有产品拥有界面时，宿主不复制一套交互；现有安装器、包管理器和更新机制优先。

在当前平台先分清改动落点：Workforce 公共 Web 界面与 Electron 原生宿主、React Native 移动壳、业务应用的页面/导航，以及 Harness 的执行生命周期分别有源码和构建所有者。沿目标项目实际配置确认本次端和包；不把其他桌面产品的 Launcher/Manager、MSI 或 OSS 方案当作这些客户端的前置条件。

业务记录和智能体工具通过应用已消费的公共 SDK/API 接入。新增外壳不能复制业务页面、另存租户身份或重建 Runtime；能力确实需要应用自管时，才继续检查执行程序、资源和退出恢复。

普通功能直接实现并验证。涉及交付、托管进程或能力程序时，沿实际入口追踪最终候选、依赖准备、健康、关闭及用户状态保留；采用与本次改变相称的安装或候选检查，不要求每个 UI 修复打完整安装包。

前端页面或截图 review 使用 `shzw-code-review` 的[视觉与体验方法](https://github.com/xingshukeji/skills-hub/blob/main/skills/shzw-code-review/modes/frontend/GUIDE.md)。开发后的视觉自查沿用该方法，只覆盖受影响页面、视口和状态；不因评审展开完整客户端交付。

需要复验实际界面，而当前可用入口无法观察、截取可信画面或完成必要操作时，在当前工具和授权允许的范围内，使用 [shzw-deskpilot-cli](https://github.com/xingshukeji/skills-hub/blob/main/skills/shzw-deskpilot-cli/SKILL.md) 检查已有安装和目标能力，按桌面、浏览器或 Android 对应指南操作并回读结果。用户明确指定 DeskPilot 时直接使用。保持指定的应用、浏览器、会话和身份；不能换一个页面或合成画面冒充原场景。DeskPilot 提供观察与操作证据，视觉质量仍按上述方法判断；原目标不可达时说明具体限制。

应用自管能力不能从插件名称推断公共 SDK 或 ABI。工具声明、幂等性、取消、秘密、进程树及持久资源各有明确所有者。首次交付验证原用户动作和受影响恢复分支，源码启动不能替代本次要求的安装后行为。

本地候选生成与正式发布分别判断；发布、签名和外部目标变更只沿已授权交付执行。

## 按需资料

- [客户端选型、UI、安装、更新及分发](modes/application/GUIDE.md)
- [应用拥有执行程序、工具、资源与生命周期的内部能力](modes/managed-capability/GUIDE.md)

按需读取命中资料。项目源码、命令和收口遵循目标项目入口；技能自身资源相对本目录解析。

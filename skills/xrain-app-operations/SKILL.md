---
name: xrain-app-operations
description: 处理 XRain 已发布应用的租户安装、升级、冲突、中断恢复、组件恢复和卸载；不构建服务镜像。
---

# 租户应用操作

有原 operation 就从原记录和当前安装接续；新安装/升级才核对市场目标。复用本轮仍有效的回执与选择。

- 安装、预检、状态恢复：[操作](references/operations.md)。
- 当前配置、版本回退、隐藏组件、卸载：[维护](references/lifecycle.md)。
- 整理回执或生成已决定的恢复请求：[工具](references/receipt.md)。

市场发布、平台导入、租户安装与用户可用是不同结果。通过原管理入口执行，保留 request/operation/revision；未知结果先查。额外删除、覆盖定制或扩大权限只处理已授权影响。

核对安装版本、组件与原用户操作；历史版本存在不代表可回退。`xrain-cli` 没有 install 命令，不能虚构。

参考和 Node.js 22.12+ 脚本位于本 skill 目录（Workforce 的 `resourceBase.path`），只使用当前获准工具。

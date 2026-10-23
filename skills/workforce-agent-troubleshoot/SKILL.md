---
name: workforce-agent-troubleshoot
description: 排查 Workforce 智能体不回复、不跟进、工具失败、重复消息、会话混淆和接管后迟到写入。
---

# 智能体运行排障

从原任务与原会话取证，关联租户、用户、本次分派及执行 ID。

- 找失败环节：[检查点](references/diagnosis.md)。
- 分派、暂停、接管、断线：[任务生命周期](references/task-lifecycle.md)。
- 智能体切换、模型、工具生效：[会话配置](references/agent-session.md)。
- 已有持久历史：[本轮历史汇总](references/history.md)。

工具协议成功、业务成功、任务状态与消息交付分别核对。未知写入先回读原结果；暂停、改派或人工接管后不能恢复旧执行权限。保留原状态，不以新空会话成功代替原问题修复；消息发送须在已有明确授权内。

从本 skill 目录（Workforce 的 `resourceBase.path`）取参考和脚本。skill 加载不授予工具；按当前工具与身份范围诊断，报告失败阶段、修复及原场景结果。

# 运行检查点

用原身份的宿主界面/API 查询，不把任意 user/tenant/session ID 传内部 Runtime。

| 症状 | 只读入口 |
| --- | --- |
| 任务没开始/不跟进 | GET /api/tasks；GET /api/tasks/{id}/execution-access、/api/tasks/{id}/execution-conversation |
| 智能体缺失/切换无效 | GET /api/workbench/agents、/agent-catalog |
| 原会话缺失 | GET /api/workbench/sessions?source=workbench；其他来源用原界面 source |
| 断流/结果不见 | GET /api/workbench/sessions/{id}/history |
| 看似卡住 | GET /api/workbench/pending-actions；原模型/工具错误 |
| 子任务未完成 | 原会话 /subagents 与历史；子任务文字不代表主任务完成 |

404 可能是来源/权限限制，接口未装配则用实例已有查询入口，不遍历别人会话。

关联同一用户、租户、任务、本次执行及 turn/tool-call，判断未触发、等输入、模型失败、工具失败、未持久化或未交付。只采时间、状态、错误码与原业务 ID。模型回复、持久消息、任务回写、外部发送分别回读；流断开先补历史，不重发用户输入。

恢复只复测原问题及相关边界：断线无重复写入，接管/改派后旧写入被拒，切换后定义及上下文隔离。发送验证使用已有明确授权与约定接收方。

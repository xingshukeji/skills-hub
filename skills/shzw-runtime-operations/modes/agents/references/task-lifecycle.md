# 任务生命周期

/api/tasks 核对原任务 status/assigneeId。execution-access **只返回 assigneeId**，不证明 grant 有效；execution-conversation 返回过滤后的 executions/messages/hasMore 或 unavailable，不提供任意 Runtime session 查询。

open 分派、确认或重开可能触发执行；/assist 202 仅表示接受。按原 handoffRef/assignmentVersion/executionId 关联，旧分派结果不能充作本轮结果。

暂停、完成、取消、改派或重开会改变执行授权。旧执行的 task.execution_forbidden 可能正确；grant 仅在受信宿主与 Runtime 间流转，不进模型、不跨任务复用。用户要求恢复时用当前任务正常动作，不把人工接管自动改回 AI。

断流先回读同一会话持久 history：throughSeq 固定快照、beforeSeq 向前翻页，hasMore/unavailable 不是无历史。只看本次输入之后的事件，旧 turn/end completed 不能证明当前完成。等待输入/批准用 pending-actions 核对，只交回必要步骤。

写工具未知先读原业务记录。实际任务完成须看本轮 workforce_update_task 结果及平台状态；assistant 最终文字、子代理 inactive 均不能替代。原负责人、当前授权、本轮历史、业务记录和界面应一致。

## 同名执行对话的不同业务范围

Task 与定时安排分别查其当前合同，不能因界面都写“执行对话”就复用同一可见性推断。Workforce 的 Task 读者可查看与该 Task 关联的安全投影；这不开放原工作台私人历史或操作权。定时安排的执行对话还要求本次执行人身份、当前安排可见资格和 Runtime 会话授权；接任负责人不因此获得前任对话正文。当前细节由 Workforce ProductContract 的 Task 规则和 DOC-0011 定时任务产品契约持有。

历史依据：2026-09-29 用户要求 Task 能显示 AI 负责人对话（聊天 `01a0ec2f-3bc0-7f22-a3ea-ec3165248feb`）；2026-10-30 的定时任务讨论另行确定执行人与运行规则（聊天 `01a1870f-3e07-7620-82ee-a0005bdff771`）。同一讨论中等待审批的总时限先选默认 30 分钟，随后明确改为 2 小时；旧选择不继续生效，实际截止仍核对当前配置。错过周期不补跑与中断运行如何恢复也是不同问题，不互相替代。

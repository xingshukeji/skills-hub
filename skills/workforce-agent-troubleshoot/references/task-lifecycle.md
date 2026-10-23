# 任务生命周期

/api/tasks 核对原任务 status/assigneeId。execution-access **只返回 assigneeId**，不证明 grant 有效；execution-conversation 返回过滤后的 executions/messages/hasMore 或 unavailable，不提供任意 Runtime session 查询。

open 分派、确认或重开可能触发执行；/assist 202 仅表示接受。按原 handoffRef/assignmentVersion/executionId 关联，旧分派结果不能充作本轮结果。

暂停、完成、取消、改派或重开会改变执行授权。旧执行的 task.execution_forbidden 可能正确；grant 仅在受信宿主与 Runtime 间流转，不进模型、不跨任务复用。用户要求恢复时用当前任务正常动作，不把人工接管自动改回 AI。

断流先回读同一会话持久 history：throughSeq 固定快照、beforeSeq 向前翻页，hasMore/unavailable 不是无历史。只看本次输入之后的事件，旧 turn/end completed 不能证明当前完成。等待输入/批准用 pending-actions 核对，只交回必要步骤。

写工具未知先读原业务记录。实际任务完成须看本轮 workforce_update_task 结果及平台状态；assistant 最终文字、子代理 inactive 均不能替代。原负责人、当前授权、本轮历史、业务记录和界面应一致。

# Document Governance

本模式的参考、脚本和资源位于加载结果的 resourceBase.path + "/modes/documents"。命令工作目录与项目事实由当前责任项目入口确定；相对资源链接按本模式目录解析。

## Goal

Keep only current facts, runnable entrypoints, necessary boundaries, and unresolved evidence. Documentation is a control plane, not a process archive.

## Load

1. Read the target root `AGENTS.md`; resolve its actual task-control owner, workflow, structure contract and validation command from that entry. Routed repositories may use shared owners outside their root. Do not create local copies or demand a missing `文档/` tree merely to follow this method.
   Read the declared candidate inventory only when the task concerns known later work, candidate inventory, promotion, or completeness of remaining work.
2. For a workspace change, read the declared WorkflowContract and select one main Workflow; read its closeout workflow before delivery.
3. Read the matched project `AGENTS.md` and only the ProductContract, CurrentDesign, Runbook or skill it routes to.
4. Read the declared StructureContract only when creating, moving, deleting or classifying documents, or when the owner is unclear.

## Workflow

1. Classify every in-scope document on two axes: its authoritative owner and its primary consumer. Then choose keep, simplify, merge, move, link or delete.
2. Put cross-project human tasks in `/人类-文档/`, project-specific human guidance in the adjacent README, and agent routing or reusable methods in AGENTS/Workflow/skill. Do not treat every file a person may read as shzw-human-documentation content.
3. Keep facts shared by people and agents in their sole ProductContract, CurrentDesign, Decision, Runbook, Material or source owner; expose them to people through links instead of copies. Split mixed documents before moving only the human task flow.
4. Preserve the sole source of a current contract, design, decision, runnable procedure, safety constraint, material or unresolved Issue. Merge duplicate facts and delete absorbed reviews, completed plans, reports, placeholders and stale navigation without tombstones.
5. Apply the actual WorkflowContract's execution, control and recovery rules. Register only work that needs recovery at its declared owner; controlled work alone does not require a persistent plan. Preserve the original task identity and remove the old registration in the same migration instead of creating a second owner.
6. Keep evidence-backed uncommitted outcomes in the declared candidate inventory, separate from authorized tasks. Promote only after an explicit user task; remove that candidate and register the result only if the adopted workflow requires recovery. An inventory is not proof that all remaining work was discovered.
7. Before a move, deletion or rule replacement, use the target entry to identify real source roots and the rule's direct readers, generators, generated entrypoints and selected installed copies. Record each affected entry's owner, keep/replace/remove decision and verification in the current task, not a permanent register. Repair inbound links, heading fragments, Depends On paths, source comments and task entries. A failed or skipped search is not evidence of no consumers. Token savings require removing an unnecessary agent default route, not merely changing a directory.
8. When a user correction changes a durable rule, identify the mistaken assumption, choose the narrowest truthful generality (`case`, `capability`, `project`, or `workspace`), and replace the conflicting rule at its sole owner. Re-evaluate dependent documents, skills, task state, candidates, and links; update the same outcome instead of appending a caveat or creating a duplicate.

## Writing Rules

For new or materially revised technical prose in workspace documents, apply the shared [受控技术写作约束](#受控技术写作约束).

- Keep only current boundary, logic, invariant, failure/compatibility behavior, verification and next executable condition.
- Keep agent entries as short conditional routers plus non-negotiable gates. Move narrative, tutorials and command sequences to the human surface, but retain shared authoritative facts at their real owner.
- Human task-page filenames match their H1 exactly. Preserve standard entry filenames, numbered durable documents and activity IDs instead of renaming them as part of unrelated cleanup.
- Product behavior belongs to ProductContract; capability implementation belongs to CurrentDesign; irreversible choice belongs to Decision; agent-facing operational selection belongs to Runbook; human procedure belongs to `/人类-文档/` or an adjacent README; specialist method belongs to skill.
- A specific incident or conversation is evidence for a correction, not automatically a workspace-wide rule. Store only the reusable invariant at the owner and level where it remains true without the originating example.
- Activity creation, registration and removal follow the adopted WorkflowContract and StructureContract. Keep one result identity; an activity must not absorb a different task or remain solely for Git closeout.
- Preserve detailed history only for a Decision, required Material or unresolved handoff. Code-reconstructible routes, DTOs, fields, test outputs and fixed defects do not become long-lived documentation.
- Read and write UTF-8. Use relative paths inside the workspace and never copy secrets, logs, customer data or generated artifacts.

## 受控技术写作约束

本节是工作空间文档语言约束的唯一方法源。规则参照 [ASD-STE100 Issue 9](https://www.asd-ste100.org/assets/files/ASD-STE100_ISSUE9.pdf) 的消歧原则，采用中文适配，不声明符合英文标准。

规则适用于本工作空间新建或实质改写的 AGENTS、skill、正式技术文档和人类操作指南的技术正文。既有文档仅在当前任务涉及时调整。规则不改变文档 Kind、事实所有权或任务授权。

1. 术语来自用户已确认的业务规则、正式契约或源码；同一概念使用同一名称。代码标识、路径、接口名称和引用原文保持原样。
2. 操作步骤用动作动词开头。说明和契约写清责任主体；只有主体已由上下文唯一确定时才省略。主体未知时写明未知，不补造责任人。
3. 一句陈述一个主要事实，一步给出一个指令；实际同时执行的动作明确标注并行。
4. 影响动作的条件写在动作前；明确“且”“或”“仅当”及先后顺序，不改变原有逻辑。
5. “必须”表示义务，“不得”表示禁止，“可以”表示许可，“建议”表示推荐；能力事实用“支持”等明确表达。
6. 一个段落只讲一个主题。默认超过六句拆段；不把英文词数上限换算为中文字数门禁。
7. 操作步骤与背景说明分开；必要动作不能只放在备注里。
8. 压缩和改写保留范围、条件、例外、责任、失败行为及必要证据；已验证事实、目标和假设明确区分。

改写后，对照原文核对术语含义、责任主体、条件、否定、例外、先后及并行关系。操作步骤还须保留预期结果和失败时下一步。文字缩短或文档检查通过，不能证明事实正确或符合完整 ASD-STE100 标准。

## Validate and Close

When formal documents or governance entrypoints changed, run the target entry's declared documentation check, targeted inbound-reference scans and scoped `git diff --check`. Use `npm run check:docs` only where that command is provided. Verify file targets and affected heading fragments separately when the checker does not cover both; structure checks do not prove fact ownership or later model behavior. Confirm human pages are not mandatory agent context and shared owners were linked rather than copied. Execute the adopted closeout conditionally: reconcile only actual long-lived facts, resolve the original activity under its lifecycle, and report the actual result, evidence and repository state. Do not run unrelated workspace-wide checks solely because concurrent files are dirty.

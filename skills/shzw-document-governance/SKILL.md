---
name: shzw-document-governance
description: Use for document governance, 文档治理, controlled technical writing when creating or materially revising workspace documents, user-controlled task execution-type and activity-plan alignment, AGENTS/Workflow/StructureContract control planes, deleting absorbed process documents or reports, reducing prompt hot paths, classifying document Kind, or aligning TASK_CONTROL with current facts.
metadata:
  maintainer: 苏州苏宏助为智能科技有限公司
  source: https://github.com/xingshukeji/skills-hub/blob/main/skills/shzw-document-governance/SKILL.md
---

# Document Governance

Resolve project entrypoints, source, documents and command working directories from the user's target project. Resolve this skill's `references/`, `scripts/` and `assets/` from its installed directory. Locate other responsible repositories through the target project's entrypoint; never infer the target from the skill installation path.

## Goal

Keep only current facts, runnable entrypoints, necessary boundaries, and unresolved evidence. Documentation is a control plane, not a process archive.

## Load

1. Read root `AGENTS.md` and `文档/TASK_CONTROL.md`.
   Read `WORK_CANDIDATES.md` under `文档/` only when the task concerns known later work, candidate inventory, promotion, or completeness of remaining work.
2. For a workspace change, read `文档/工作流/WORKFLOW_CONTRACT.md` and select one main Workflow; read WF-0004 before closeout.
3. Read the matched project `AGENTS.md` and only the ProductContract, CurrentDesign, Runbook or skill it routes to.
4. Read `文档/WORKSPACE_STRUCTURE.md` only when creating, moving, deleting or classifying documents, or when the owner is unclear.

## Workflow

1. Classify every in-scope document on two axes: its authoritative owner and its primary consumer. Then choose keep, simplify, merge, move, link or delete.
2. Put cross-project human tasks in `/人类-文档/`, project-specific human guidance in the adjacent README, and agent routing or reusable methods in AGENTS/Workflow/skill. Do not treat every file a person may read as shzw-human-documentation content.
3. Keep facts shared by people and agents in their sole ProductContract, CurrentDesign, Decision, Runbook, Material or source owner; expose them to people through links instead of copies. Split mixed documents before moving only the human task flow.
4. Preserve the sole source of a current contract, design, decision, runnable procedure, safety constraint, material or unresolved Issue. Merge duplicate facts and delete absorbed reviews, completed plans, reports, placeholders and stale navigation without tombstones.
5. Classify each task on three independent axes through `WORKFLOW_CONTRACT.md`: execution type, normal or controlled strength, and temporary or durable recovery. Never declare a project/session current phase or use CI, release gates, test tooling, breadth, candidates or environments to create an unrequested SystemTest. Put only user-authorized durable work and every active ChangePlan/SystemTestPlan/DeploymentPlan/Issue in `TASK_CONTROL.md`; controlled strength alone does not register work.
6. Put only independent, evidence-backed, uncommitted outcomes in `WORK_CANDIDATES.md`. Require a valid Basis, one actual Owner, a user-visible Trigger, and dependencies; omit status, execution type, environment, artifact, target and authorization. Promote only on an explicit user task by atomically removing the candidate, classifying the three axes, and registering only when durable recovery is required. Treat the inventory as known, not exhaustive; audit the declared scope before claiming completeness.
7. Repair all inbound links, Depends On paths, source comments, task entries and skill references before deleting or moving a path. Token savings require removing an unnecessary agent default route, not merely changing a directory.
8. When a user correction changes a durable rule, identify the mistaken assumption, choose the narrowest truthful generality (`case`, `capability`, `project`, or `workspace`), and replace the conflicting rule at its sole owner. Re-evaluate dependent documents, skills, task state, candidates, and links; update the same outcome instead of appending a caveat or creating a duplicate.

## Writing Rules

For new or materially revised technical prose in workspace documents, apply the shared [受控技术写作约束](#受控技术写作约束).

- Keep only current boundary, logic, invariant, failure/compatibility behavior, verification and next executable condition.
- Keep agent entries as short conditional routers plus non-negotiable gates. Move narrative, tutorials and command sequences to the human surface, but retain shared authoritative facts at their real owner.
- Human task-page filenames match their H1 exactly. Preserve standard entry filenames, numbered durable documents and activity IDs instead of renaming them as part of unrelated cleanup.
- Product behavior belongs to ProductContract; capability implementation belongs to CurrentDesign; irreversible choice belongs to Decision; agent-facing operational selection belongs to Runbook; human procedure belongs to `/人类-文档/` or an adjacent README; specialist method belongs to skill.
- A specific incident or conversation is evidence for a correction, not automatically a workspace-wide rule. Store only the reusable invariant at the owner and level where it remains true without the originating example.
- ChangePlan records one durable controlled Development A→B task; SystemTestPlan records one explicitly requested durable controlled candidate/environment campaign and its request source; DeploymentPlan records one explicitly requested artifact/target operation and is always durable. Temporary work has no activity document even when controlled. Each activity document is deleted when its own task concludes and must never absorb a different execution type. Issue exists only while a recoverable problem remains.
- Preserve detailed history only for a Decision, required Material or unresolved handoff. Code-reconstructible routes, DTOs, fields, test outputs and fixed defects do not become long-lived documentation.
- Read and write UTF-8. Use relative paths inside the workspace and never copy secrets, logs, customer data or generated artifacts.

## 受控技术写作约束

本节是工作空间文档语言约束的唯一方法源。规则参照 [ASD-STE100 Issue 9](https://www.asd-ste100.org/assets/files/ASD-STE100_ISSUE9.pdf) 的消歧原则，采用中文适配，不声明符合英文标准。

规则适用于本工作空间新建或实质改写的 AGENTS、skill、正式技术文档和人类操作指南的技术正文。既有文档仅在当前任务涉及时调整。规则不改变文档 Kind、事实所有权或任务授权。

1. 术语来自既有领域模型、正式契约或源码；同一概念使用同一名称。代码标识、路径、接口名称和引用原文保持原样。
2. 操作步骤用动作动词开头。说明和契约写清责任主体；只有主体已由上下文唯一确定时才省略。主体未知时写明未知，不补造责任人。
3. 一句陈述一个主要事实，一步给出一个指令；实际同时执行的动作明确标注并行。
4. 影响动作的条件写在动作前；明确“且”“或”“仅当”及先后顺序，不改变原有逻辑。
5. “必须”表示义务，“不得”表示禁止，“可以”表示许可，“建议”表示推荐；能力事实用“支持”等明确表达。
6. 一个段落只讲一个主题。默认超过六句拆段；不把英文词数上限换算为中文字数门禁。
7. 操作步骤与背景说明分开；必要动作不能只放在备注里。
8. 压缩和改写保留范围、条件、例外、责任、失败行为及必要证据；已验证事实、目标和假设明确区分。

改写后，对照原文核对术语含义、责任主体、条件、否定、例外、先后及并行关系。操作步骤还须保留预期结果和失败时下一步。文字缩短或文档检查通过，不能证明事实正确或符合完整 ASD-STE100 标准。

## Validate and Close

When formal documents or governance entrypoints changed, run `npm run check:docs`, targeted inbound-reference scans and scoped `git diff --check`; confirm human pages are not mandatory agent context and that shared owners were linked rather than copied. Do not run a workspace-wide diff check solely for an unrelated dirty worktree. Execute WF-0004 conditionally: reconcile only real long-lived facts, remove this task's activity entry when its completion rule passes, and append a completion fact only for a registered result that will affect later choices. Never retain one task plan for a different execution type or Git closeout. Report this task's type, conclusion, evidence, and repository state; mention another task type only when the user requested or the workflow actually established it.

# Technical Solution

本模式的参考、脚本和资源位于加载结果的 resourceBase.path + "/modes/design"。命令工作目录与项目事实由当前责任项目入口确定；相对资源链接按本模式目录解析。

## Goal

Establish or reuse the compact direction contract: outcome, boundary, this task's execution type, invariants, ownership, completion rule and material open decisions. Load [本入口的 direction 方法](../direction/GUIDE.md) only when a material direction choice cannot be resolved from available facts and user instructions. Preserve settled decisions; pause dependent implementation only for a blocking choice, missing evidence or authority.

For a requested solution or review, map the outcome to current support, required change, owner, evidence and material open decisions. For already authorized implementation, establish the necessary working plan and continue through implementation and verification. Add UI, API, data, operations, security or migration detail only when affected; a plan does not require a separate presentation or approval round.

Use this skill only for a requested solution or a controlled technical change under WF-0002. Do not invoke it for a change classified as normal by `WORKFLOW_CONTRACT.md`; those changes use the user request, targeted fact discovery, source, types and tests directly.

This skill is Development-only. A coding-ready solution defines the scoped verification needed for the requested result, including actual consumer or UI behavior when required, and may name a possible candidate output. It must not add an independent system-test campaign or deployment sequence as implementation steps. Route an explicitly requested SystemTest objective to its skill, which separately chooses control strength and persistence; Deployment always receives its own durable controlled task and plan. Do not call either a project or session phase transition.

An explicit implementation request authorizes its necessary planning and coding within scope once the coding-ready gate below is satisfied. Do not require separate direction approval when existing authorization and facts settle it. A solution-only request authorizes the requested design deliverable, not coding. If a blocking fact or observable acceptance surface is missing, pause dependent implementation and continue independent authorized work.

## Artifact delivery

Treat an explicit request to “输出技术方案”, “形成技术方案” or “给出技术方案” as authorization to create or update one formal Markdown artifact in the workspace and return a concise chat summary with its path. Apply the same rule when the user adds “文档”; do not require that extra word. Before writing, use [shzw-workspace-maintenance](https://github.com/xingshukeji/skills-hub/blob/main/skills/shzw-workspace-maintenance/modes/documents/GUIDE.md) to locate the sole truthful owner and `文档/WORKSPACE_STRUCTURE.md` to select its Kind and placement:

- use the existing or new `CurrentDesign` for durable capability implementation design;
- use `Decision` for an irreversible choice and its alternatives;
- use `ChangePlan` only when an authorized implementation needs durable recovery, never merely because a solution document was requested;
- update the existing sole owner instead of creating a parallel solution document; stop and explain when no truthful formal owner exists.

The artifact request does not authorize coding, SystemTest, Deployment, `TASK_CONTROL.md`, or `WORK_CANDIDATES.md`. Classify the primary task through `WORKFLOW_CONTRACT.md`: a document-only delivery uses the matching non-code document workflow, while an authorized technical implementation keeps its own Development workflow and updates the durable owner in that task.

Keep exploratory and review requests chat-only. When the user says “先讨论”, “先评估”, “只在对话输出”, “先质疑”, “不要改文件” or equivalent, do not create or update an artifact. A request to challenge an existing proposal routes to `本入口的 challenge 方法` and leaves that proposal unchanged.

Behavior cases:

- Positive: “输出客户导入技术方案” creates or updates the truthful formal design owner and returns a short linked summary.
- Negative: “先讨论客户导入可行性，不要改文件” returns discussion only and leaves the workspace unchanged.

## Load

Reuse current root `AGENTS.md`, `文档/TASK_CONTROL.md` and matched project context; load the actual durable formal owner and missing facts needed by the task. Read `references/solution-template.md` when delivering a requested solution document or detailed handoff; a temporary controlled implementation can keep its compact working plan in the task. When changing the workspace or preparing durable recovery, read `文档/工作流/WORKFLOW_CONTRACT.md` and the main Workflow. For an explicit artifact request, read [shzw-workspace-maintenance](https://github.com/xingshukeji/skills-hub/blob/main/skills/shzw-workspace-maintenance/modes/documents/GUIDE.md) and `文档/WORKSPACE_STRUCTURE.md`. Do not create a placeholder CurrentDesign when another owner or source and tests already carry the facts; stop a required artifact write if no truthful durable owner can be identified.

## Build the solution

### Requested solution or review

Use a decision table when comparing choices; a simple decision can use concise prose. Cover the relevant fields:

| Outcome / decision | Current support | Required change | Owner | Evidence | Open decision |
|---|---|---|---|---|---|

- Describe only affected dimensions. For example, add a short UI/API/data/security/operations note when it changes the decision; do not require a fixed layer checklist for every outcome.
- Group closely related surfaces and actions by business capability; do not repeat every component, field, endpoint, test class, or historical detail in the main plan.
- State the recommended order and known prerequisites that could prevent delivery. Resolve discoverable capability, artifact, environment and access facts before presenting material decisions. Verify the actual supported consumer path and representative data shape before dependent work; for a result spanning components, keep one owner of the complete outcome and require evidence from its actual consumer. Reuse matching evidence and repeat only checks affected by a change, failure or unresolved concern. Authorization continuity follows the target WorkflowContract.
- Distinguish already authorized work, a requested design deliverable, and work blocked by a concrete product/ownership decision.
- State schema, migration, public-contract, operational, or compatibility impact only when the outcome reaches that boundary. Name concrete assets only when verified.
- Resolve questions from supplied materials, settled decisions and supported capabilities first. Make ordinary implementation choices when the evidence is sufficient. Group the remaining material product choices by their shared consequence; present the evidence, two or three mutually exclusive options and a recommendation. Do not ask field by field or reopen settled scope. Pause only the dependent part; a repairable source-data issue does not by itself block the rest of a model.
- Give a short explicit list of rejected/non-goal legacy behavior so review does not reopen it accidentally.

When a user correction changes the direction contract, regenerate every dependent section and remove incompatible scope, completion, plan, skill, or document wording. Do not preserve the old assumption as a caveat or add a second rule beside it.

Use exact paths, routes, contracts, tables, jobs, and owners only to substantiate a decision or when a coding-ready follow-up is requested. Keep the main plan concise.

### Working plan for authorized implementation or requested detail

Cover these items in substance, using only the structure needed by the task:

1. Goal and Scope
2. Facts and Sources
3. Plan and Change Boundary
4. Agent Constraints
5. Success Criteria
6. Stop Implementation Conditions
7. Verification
8. Open Questions and Non-Goals

Use exact paths, routes, contracts, tables, jobs, and owners when verified. Separate verified facts from assumptions and inferences. For phased work, state prerequisites, this phase's stopping boundary, downstream handoff, and explicit exclusions.

## Bound complex work before sustained execution

Use this method when the outcome contains independently acceptable results, shared contracts/resources, or repeated implementation and validation cycles. Keep a small, clear task direct. The authorization and coordination constraints belong to the target project's `文档/工作流/WORKFLOW_CONTRACT.md`; this method does not authorize creating conversations or delegating agents.

1. **Inspect the critical path first.** Trace a representative user action through the actual entrypoints, adapters, authorization, persistence/query and returned UI result where relevant. Identify bypasses, old implementations still in use, consumers and missing evidence before declaring the design implemented. Do not turn this into a repository-wide audit.
2. **Split by observable result and ownership.** Give each unit a finite completion rule, allowed files/contracts, exclusions, prerequisites and required evidence. A name or a frontend/backend split alone does not establish independence. Assign each shared file and mutable resource one owner; fix the consumed contract before dependent writes. Consumers report a concrete upstream need rather than modifying upstream files. Record which original acceptance criteria each unit covers so decomposition neither loses requirements nor adds new ones.
3. **Fix a recoverable baseline.** Identify the source revision plus any relevant uncommitted delta, package/candidate and environment. Reuse a valid existing baseline; checkpoint through the Git rules when authorized and eligible, without making a clean repository or commit a prerequisite to every unit. Do not freeze or rebuild packages merely to create paperwork. State unverified assumptions separately from accepted facts.
4. **Keep one current evidence list.** For each acceptance item record passed, specific defect, or missing evidence, with the source/candidate identity and a precise test or observation. Replace stale status rather than appending contradictory history. Test counts, successful builds and another candidate's results do not prove unobserved behavior. Reuse matching evidence; only a relevant change, failure or concrete unresolved question justifies rerunning or broadening checks. Share one necessary consumer/candidate validation after the affecting changes settle instead of rebuilding it per unit.
5. **Route discoveries without scope creep.** Fix an in-scope defect in its owning unit. Return an upstream defect with input, expected/actual behavior, evidence and the affected prerequisite to the coordinator. Keep unrelated work out of the current unit; use existing candidate rules only when applicable. Continue independent work while a real dependency is pending. Do not recursively dispatch tasks to resolve uncertainty.
6. **Correct execution when it stops converging.** If successive cycles do not reduce the concrete remaining items, or repeatedly rediscover the same source, rebuild candidates or rerun equivalent checks, stop that repeated action and investigate. Distinguish a confirmed live wait or new failure evidence from repetition. Revise the decomposition, baseline or ownership within existing authorization; ask only for a material unresolved user decision. Report the finite remaining list and the next evidence that can change it, not an open-ended promise to keep reviewing. Do not impose arbitrary time limits or sacrifice necessary correctness checks to appear fast.
7. **Close each result, then reconcile.** An execution unit ends with its result, exact delta, evidence and specific dependency defects. The coordinator checks coverage and compatibility across units, rather than repeating all their work. Evidence still missing remains explicitly missing; no percentage, checkpoint, or long-running effort substitutes for acceptance. Keep Git state separate and follow existing activity cleanup rules.

Keep this working state in the current plan; use the existing ChangePlan only when persistence already applies. Do not add a universal report, transcript, per-unit activity file or another governance registry. If the user requests separate tasks, their handoff must include the boundaries and baseline above, the coordinator, and an explicit completion point.

Use the [bounded execution examples](references/bounded-execution-examples.md) to check this method against complex work, small fixes and unchanged evidence.

## Coding-ready gate

Do not hand the plan to coding unless:

- it preserves the direction contract without redefining its outcome, invariants, ownership, or completion rule;
- the allowed change surface and prohibited dependencies are explicit;
- critical behavior is grounded in source, measured state, or an authoritative contract;
- success is observable through named UI actions, tests, APIs, CLI output, artifacts, or database checks;
- validation commands/checks are concrete and proportionate to risk;
- Development completion evidence covers the requested result and its necessary checks, with repository state reported separately; SystemTest or Deployment appears only when the user requested or the workflow actually established those independent tasks;
- missing facts, unavailable secrets/access, unauthorized expansion, and unresolved product choices are stop conditions;
- non-goals prevent scope drift.

Agent constraints must directly state what to read, what may/must not change, required validation, secret limits, and behavior that must remain stable.

Before coding any controlled technical change, establish its A→B delta, agent constraints, observable success criteria and stop conditions. For temporary execution, keep that plan in the current task and do not create persistence artifacts. For durable recovery, register the unfinished task and save exactly one `Kind: ChangePlan`, `Workflow: WF-0002` document under the project's or workspace's `推进中/` directory. `Draft` does not authorize coding. A persisted ChangePlan must depend on at least one actual durable formal owner and state the delta that owner will receive when its facts change; CurrentDesign is required only for capability-design changes.

## Closeout

Keep non-blocking questions separate from stop conditions. When an artifact was requested, ensure its formal metadata, inbound routing and sole-owner relationship are valid, run the document gate and return a clickable path in the summary. Register only user-authorized executable work that needs durable recovery in `文档/TASK_CONTROL.md`; controlled strength alone is insufficient. After the requested outcome and necessary verification are complete, do not keep a Development task or ChangePlan active solely because Git closeout or another explicitly requested task remains. A requested SystemTest objective is a separate task and gets an activity plan only when durable and controlled; Deployment always gets its own durable task and plan. Add `WORK_CANDIDATES.md` only when verified work leaves an independent, evidence-backed, uncommitted outcome; do not type it or auto-promote it. Before reporting completion, execute WF-0004 conditionally and report repository state separately.

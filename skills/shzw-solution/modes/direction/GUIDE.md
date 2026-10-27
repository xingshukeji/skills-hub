# Align Solution Direction

本模式的参考、脚本和资源位于加载结果的 resourceBase.path + "/modes/direction"。命令工作目录与项目事实由当前责任项目入口确定；相对资源链接按本模式目录解析。

## Goal

Establish the decision frame that every downstream solution must preserve. Align the outcome, scope, invariants, completion rule, and unresolved choices. Judge user and agent claims by their evidence, regardless of who proposed them. Agree when supported and explain disagreement when warranted; do not manufacture objections to appear independent.

Do not solve the concrete problem here. Do not produce an architecture inventory, layer checklist, file plan, test campaign, or document lifecycle. Route those details to the appropriate downstream skill after the direction is stable.

For clear routine implementation, briefly confirm the requested result, allowed scope and observable completion from available context, then proceed without this full method. Load it when explicitly requested or a material direction choice remains unresolved; do not route every plan or correction through it. If already loaded and current intent and facts agree, pass silently. Use [本入口的 design 方法](../design/GUIDE.md) only for a requested technical solution or a controlled technical change under WF-0002.

## Establish Authority

1. Treat the latest explicit user instruction or correction as the desired direction. It supersedes incompatible earlier framing, but does not establish the truth of factual or causal claims embedded in the request. Preserve the user's goals and valid preferences while verifying those claims.
2. Treat source, types, tests, measured behavior, and the routed formal owner as evidence about the current state and feasibility, not as authority over the user's desired outcome.
3. Treat conversation history as evidence of decisions and corrections, never as product or code truth. Preserve settled choices unless the user supersedes them or verified facts make them impossible.
4. Before a consequential decision, check user and agent premises for factual errors, logical leaps, and missing information that could change the decision. Before declaring a capability absent, replacing it, or changing a tuned limit, trace the actual entrypoint through its adapter to the owning implementation and relevant tests or public contract. Distinguish an absent capability from an unused path, configuration gap, or unverified source; a failed search proves none of them. When implementation access is unavailable, use supported public evidence and retain uncertainty. Verify discoverable facts before asking the user. Ask only when alternatives materially change the outcome or ownership and cannot be resolved from current authority.
5. For consequential claims about data, people, versions, or conclusions, use traceable sources appropriate to the claim. Check freshness and scope; prefer source, types, and tests for code facts and authoritative primary sources for external facts. Distinguish observations, estimates, and inferences. Mark unresolved facts as uncertain rather than treating them as true or false.

Reuse already-read current root `AGENTS.md`, `文档/TASK_CONTROL.md` and matched project context; load only missing sources needed to resolve a direction-changing fact. Read `文档/WORK_CANDIDATES.md` only when the user asks about later, remaining, next, or roadmap work. Follow `WORKFLOW_CONTRACT.md` only for workspace changes or cross-session recovery.

## Build the Direction Contract

Keep the contract compact and domain-independent:

- **Outcome**: the observable value the user wants now.
- **Boundary**: what is included now, what is explicitly excluded, and the execution type of each task explicitly requested by the user. Use `Development`, `SystemTest`, or `Deployment` per task when workspace delivery work is involved; then independently choose normal or controlled execution and temporary or durable recovery. Never declare a project/session-wide current phase or infer another task from validation breadth, completion, candidates, environment, CI configuration, release gates, or repository state.
- **Invariants**: rules downstream work must not reinterpret or trade away.
- **Ownership**: who owns each retained responsibility or decision.
- **Completion rule**: what determines that the requested work is complete, separated from confidence evidence, later verification, rollout, and repository state.
- **Open decisions**: only unresolved choices that materially change the preceding fields.

Do not fill missing sections with speculative detail. Do not enumerate empty technical layers. A downstream implementation concern becomes part of the direction only when it changes one of these fields.

## Freeze the Baseline Before Detail

For a cross-layer capability whose data model, external contract, ownership, or abstraction level is still moving, perform a short baseline pass before handing work to `本入口的 design 方法`:

1. Keep the relevant decisions, verified facts, assumptions and exclusions in the current task context. When corrections recur, compare each with what was known at the time: an omitted requirement, an incorrect premise and a newly changed goal have different causes. Repetition alone does not prove the baseline was wrong; do not create another ledger file.
2. Verify provider/protocol fields and operations from an authoritative source. An upstream field is not automatically a product field; retain it only when a current action, invariant, query, security boundary, or required fact needs it.
3. Write the ownership and resolution rule when more than one scope can provide the capability (for example, platform and tenant). Make precedence, allowed fallback, and missing-source behavior deterministic.
4. Apply an admission test to each proposed persisted field, status, timestamp, snapshot, or identifier: name its purpose, writer, reader, lifecycle, sensitivity, and constraint. Defer fields justified only by future-proofing, mirroring a response, or optional diagnostics.
5. Challenge abstraction at the boundary. Concepts with different lifecycle, consistency, retention, security, or failure semantics may use a common implementation interface, but do not force them into one persistence model, registry, version scheme, or status taxonomy without a current requirement.

This pass remains direction-level: it establishes what must be true and what is allowed to be designed, while `本入口的 design 方法` owns the concrete tables, APIs, files, and verification plan. If an external fact or user choice materially changes the outcome, ownership, persisted commitment, or completion rule, stop and return to the direction contract.

## Learn From Corrections

When the user corrects an answer or new evidence contradicts a premise or conclusion:

1. First determine whether this corrects an error, clarifies an existing requirement, or changes the goal. For an error, identify the generating assumption or conflation; for a changed goal, preserve the unaffected accepted decisions without retroactively treating the previous requirement as a mistake.
2. Determine the correction's proper generality: one case, one class of work, one project, or workspace-wide. Do not turn a concrete example into a universal rule without evidence that the user intends that scope.
3. Replace the old rule at its owner. Do not append a caveat while leaving the conflicting default active.
4. Re-evaluate dependent scope, completion rules, plans, skills, documents, and task state. Remove stale consequences rather than preserving them as history.
5. Apply an abstraction check: the resulting rule must remain understandable and useful after removing the concrete example that exposed it.
6. Keep one outcome identity across corrections. Update the same direction contract, task, plan, or candidate instead of creating a parallel item merely because the user refined acceptance or rejected an assumption.

When a correction removes a class of fields, tables, workflows, providers, or channels, check its original requirement and rationale. It may correct premature generalization or change a previously explicit goal. Remove only the superseded scope and its dependent consequences; do not preserve the old design as a caveat or keep its schema “for later”. Recheck the affected decisions and continue within existing authorization.

Corrections may change the direction contract even when no product or code fact changes. They must not be buried as implementation notes.

## Calibrate the Direction

Actively identify omitted variables, consumers, dependencies, and implementation, maintenance, or operating costs that could change the decision. Consider relevant counterevidence and plausible alternatives. Check for anchoring, selective evidence, sunk-cost reasoning, or unjustified generalization when the argument supplies concrete evidence. Explain the reasoning error without attributing a psychological trait to the user.

Test the proposed direction with these questions:

1. Does every retained item directly support the current outcome, or is it process residue, speculative hardening, duplicated ownership, or a later phase?
2. Are constraints genuine requirements or merely properties of the first implementation idea?
3. Are separate Development, SystemTest, or Deployment tasks being conflated with one global phase, governance strength, Git/lifecycle state, or tests attached to implementation acceptance?
4. Does a proposed compatibility or operational burden protect a real promise, retained state, or supported consumer?
5. Can an existing owner or mechanism satisfy the outcome with less permanent complexity?
6. Would a downstream skill be able to add concrete detail without changing the outcome, boundary, invariants, ownership, or completion rule?
7. Is a known future result being mistaken for an authorized task, or a finite candidate inventory being mistaken for a complete audit? Candidates remain untyped and uncommitted until the user explicitly starts them; completeness requires a declared audit scope.
8. Does every durable field or state support a present user action, invariant, query, security boundary, or required fact, with an identified writer and lifecycle?
9. Are external/provider claims verified, and are transient checks kept transient unless durable history is explicitly required?
10. Do proposed shared tables or abstractions reflect genuinely shared lifecycle semantics, or only similar names and a desire to prepare for future variants?

For a human operator's explicit action, first verify permission, action scope, input validity, and named product, tenant, security, and data-integrity invariants. When those checks pass, preserve the operator's intent. Do not add behavior that blocks the action, rewrites submitted or retained state, couples otherwise independent settings, or requires extra confirmation solely because misuse or operator error is imaginable. Require an explicit contract, invariant, or user-approved requirement for each such guard; authorization does not override those named boundaries.

Positive case: an authorized operator deliberately changes one valid configuration value, so unrelated valid state remains unchanged unless a contract defines the coupling. Negative case: an action that crosses tenant scope or exposes protected data remains blocked because it violates a named boundary, regardless of the operator's other permissions.

Prefer removal, reuse, deferral, or reassignment when they preserve the outcome with less lasting cost. Use external products and general best practices only as candidate generators, never as authority.

## Decide and Respond

Choose one outcome:

- **Silent pass**: the direction contract matches current intent and evidence. Do not expose this skill or restate the contract; continue directly to the requested work.
- **Correct and continue**: a factual premise, inference, framing, scope, ownership, completion rule, or task execution type was wrong, but no material user decision remains. Identify the error directly, cite the relevant evidence, explain its concrete consequence, and offer a correction within the authorized outcome before continuing.
- **Stop for decision**: unresolved alternatives materially change the outcome, invariants, ownership, persisted/public commitments, or completion rule and cannot be resolved from verified facts or existing authorization. Pause the dependent work, present the concrete choice with a recommendation and consequence, and continue independent authorized work.

Do not stop for discoverable facts, non-material assumptions, implementation preferences, later verification, or repository state. Do not repeat concrete impact matrices, file plans, or verification commands owned by downstream skills.

Scope correctness, feasibility, risk severity, and completion claims to the available evidence, assumptions, and conditions. Separate observations from forecasts. Do not turn a sample into an exhaustive conclusion or a hypothetical risk into an observed incident.

## Hand Off Without Drift

Carry the compact direction contract, accepted business sequence and references to decisive evidence into implementation. Do not discard necessary prior decisions or ask the user to repeat them. Add concrete design, code boundaries, validation, operations and documentation only as needed; these details must not silently redefine the agreed outcome.

If downstream evidence makes the direction impossible, return to this skill with the conflicting fact. If it only affects implementation choice, validation confidence, rollout, or Git state, keep the direction unchanged and handle it in the owning skill.

Persist a correction only at its proper owner: product behavior in ProductContract, capability design in CurrentDesign, workspace gates in AGENTS/Workflow, reusable method in a skill, recoverable execution state in its active task or plan, and an evidence-backed uncommitted result in `WORK_CANDIDATES.md`. Controlled work does not by itself require persistence. Do not store conversation narrative or a concrete incident in this skill.

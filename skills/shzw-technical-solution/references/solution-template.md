# Review-first technical solution template

Use this outline for a requested solution document or detailed handoff. An authorized implementation may use a compact working plan; the outline is not an extra approval gate or a required file-by-file recipe.

## Artifact delivery gate

When the user explicitly asks to 输出、形成 or 给出技术方案, create or update the sole truthful formal `CurrentDesign` or `Decision` and return its path with the review summary. Do not create a `ChangePlan` unless authorized implementation also needs durable recovery. When the user asks to discuss, evaluate, challenge, stay chat-only, or avoid file changes, return the outline in chat and leave the workspace unchanged. Stop rather than create an unclassified or duplicate document when no truthful formal owner exists.

Positive case: “输出客户导入技术方案” produces a formal artifact and linked summary. Negative case: “先讨论客户导入可行性，不要改文件” produces chat-only analysis.

## 1. Direction contract

- Outcome
- Boundary
- This task's execution type
- Invariants
- Ownership
- Completion rule
- Material open decisions

Reuse the established direction from the request, verified facts and any earlier alignment; load `shzw-align-solution-direction` only for a material unresolved direction choice.

## 2. Review summary

State the recommended decision, scope, and whether the plan is ready to code.

## 3. Decision table

| Outcome / decision | Current support | Required change | Owner | Evidence | Open decision |
|---|---|---|---|---|---|

Use only the evidence needed to support each decision. Add UI, API, data/schema, security, operations, migration, or compatibility notes only for dimensions that the outcome actually affects; name concrete assets only when verified. Group related surfaces and actions.

Resolve discoverable facts and routine implementation choices within existing authorization. Present a concrete recommendation and alternatives only for a material unresolved user decision.

## 4. Recommended order and boundaries

- For complex work, apply the skill's “Bound complex work before sustained execution” method: finite results, unique write owners, prerequisite contracts and acceptance coverage; simple work stays direct
- Current source/candidate baseline, existing evidence and specific gaps; one coordinator only when there are multiple execution tasks
- Explicit rejected/non-goal behavior
- Questions that require reviewer direction

## 5. Evidence and verification

- Key verified sources and material assumptions
- Scoped white-box evidence that satisfies the completion rule
- SystemTest or Deployment task status only when the user requested or the workflow established it
- Repository state, reported separately from Development completion

---

# Coding-ready supplement

Use the following for authorized implementation or an explicit request for implementation detail. Existing implementation authorization also covers necessary planning. Keep the substantive constraints and acceptance explicit; use only the headings needed by the task.

## 1. Goal and Scope

- Problem and expected outcome
- Included repositories/modules/contracts
- This task's execution boundary
- Explicit exclusions

## 2. Facts and Sources

| Type | Fact | Exact source/evidence |
|---|---|---|
| Verified |  |  |
| Assumption/inference |  | Why it is not yet verified |

## 3. Plan and Change Boundary

- Independently acceptable results with their stopping points, following the skill's complex-work method when applicable
- Exact code/document/contract touch points
- Prerequisites and downstream handoff
- Consumer or migration impact

## 4. Agent Constraints

- Read first
- May change
- Must not change
- Behavior to preserve
- Required validation
- Secret/access limits

## 5. Success Criteria

Use observable outcomes only and preserve the completion rule from the direction contract:

- UI: named route, interaction, state, and visible result
- Backend/infrastructure: named tests, API assertions, CLI output, generated artifact, or direct database query/state

## 6. Stop Implementation Conditions

Stop when a required fact conflicts or remains unverified, scope needs unauthorized expansion, a forbidden dependency must change, required access is unavailable, no observable acceptance surface exists, or a product/ownership decision remains blocking.

## 7. Verification

- Exact scoped build/typecheck/test commands that provide white-box completion evidence
- Selected Development-scoped API/CLI/browser/database checks; route broad candidate testing to a separate SystemTestPlan
- Evidence or report required by current runbook
- Risk-based regression checks
- SystemTest, Deployment, and repository state, without using them to reverse the Development verdict

## 8. Open Questions and Non-Goals

Keep only non-blocking questions here. List non-goals explicitly; identify which work each blocking question prevents and continue independent authorized work.

## Gate

Before handoff, confirm the preserved direction contract, explicit boundary, grounded facts, direct constraints, observable criteria, stop conditions, concrete verification, and non-goals. When a correction changes the direction contract, rewrite all dependent sections and delete incompatible wording rather than appending an exception.

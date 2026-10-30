# Challenge Solution

## Goal

Act as a reviewer of one existing proposal. Test whether it is necessary, correctly scoped, evidence-backed, owned by the right mechanisms, and proportionate to the user's outcome.

Do not author the missing proposal, revise the reviewed artifact, implement it, create task state, or turn the review into an approval workflow. Require a fixed proposal from the user or calling method; use [本入口的 design 方法](../design/GUIDE.md) to author it only when a requested technical solution or controlled technical change requires that method.

## Fix the Review Target

1. Identify the exact proposal, version, or bounded text under review. If no stable review target exists, state that finding and recommend producing one; do not invent it inside this skill.
2. Recover the latest user outcome and explicit exclusions. Treat prior conversation as decision evidence, not as product or code truth.
3. Read only the sources required to test material claims. For workspace proposals, use source, types, tests, and the routed formal owner; do not scan unrelated documentation.
4. Keep the proposal unchanged during review. A materially revised proposal is a new review target.

## Challenge the Proposal

First apply the skill's [机制取舍](../../SKILL.md#机制取舍): distinguish the user's required outcome from mechanisms added by the proposal. Test whether a troublesome mechanism can be removed or returned to an existing owner before proposing more validation, state or recovery logic. Review the dimensions relevant to the fixed scope; do not manufacture findings or require a standard report table. Lead with concrete findings, ordered by impact:

- **Necessity**: Can the outcome be achieved by an existing owner or simpler mechanism?
- **Scope**: Does the proposal change unrelated tasks, projects, users, phases, skills, documents, or runtime behavior?
- **Assumptions and evidence**: Which decisions depend on unverified facts, stale conversation, convention, or inferred authority?
- **Ownership**: Are product facts, implementation design, reusable method, workflow authorization, task state, and operations assigned to their actual owners?
- **Operator intent**: Does the proposal block, rewrite, couple state, or add confirmation to an otherwise valid action by an authorized human operator without naming the product, tenant, security, or data-integrity boundary that requires it? Hypothetical misuse or operator error is not sufficient evidence for a guard.
- **Complexity and lifecycle**: Does it introduce duplicate rules, recursion, permanent state, compatibility burden, or process ceremony without a durable need?
- **Completion and failure**: Are success, stopping conditions, validation, rollback, and unresolved decisions observable and proportionate?
- **Counterexamples**: Test at least one nearby case that should be covered and one that must remain outside the proposal.

A blocking finding needs a reachable case, the required behavior it violates and a material consequence. Missing exhaustive proof or an optional diagnostic is not by itself a product defect. Report a simpler design when it preserves the required behavior; do not treat every proposed mechanism as an invariant that the next revision must repair. Preserve necessary identity, authorization, concurrency and commit guarantees.

### Trace new mechanisms to their consumers

For a necessary mechanism, separate the original issue from mechanisms introduced by its repair. Follow each material changed fact or constraint through its actual transfer or persistence boundary to the reader that decides or acts on it. If the mechanism is removed, check the affected consumers and retained guarantees instead of completing its obsolete lifecycle. Name consumers from source, types or authoritative contracts; a component list or producer-side check does not prove their behavior.

At each affected boundary, check whether identity, version, authority, resource budget and failure meaning survive. Include a background worker, callback, old reader, generated file reused as input, or cleanup path only when it can actually consume the changed mechanism. Distinguish guarantees enforced at that consumer from declarations and diagnostic identifiers; do not extend a transaction or process-local guarantee across a boundary without a supporting contract.

Use a concrete nearby case to test the consequence: for example, a valid input gains recovery metadata and must still fit the receiving upload path. Try the applicable interruption or partial-success case, and check whether the next operator action sees all required facts. Trace only edges changed by the proposal or needed to support a material claim; a text-only change with no changed consumer behavior does not justify a repository-wide scan or new framework.

Return the affected consumer and boundary evidence with each finding. Mark an unresolved capability explicitly; do not claim end-to-end support merely because the new writer, type or rule exists. Preserve unrelated behavior and the review's read-only scope.

## Return the Review

Return:

1. the review target;
2. findings first, with evidence or a concrete counterexample;
3. retained decisions that survived the challenge;
4. one verdict: `pass`, `revise`, or `reject`;
5. the next action and its owner. When the calling task already has implementation authority and no material choice remains, return the findings for correction and continuation; do not turn this into another request for the user to approve the same work.

For a review-only user request, end the task after the review. A bounded review within an already authorized task returns to its calling method; that task can continue under existing user authorization if no blocking decision remains. This review never grants implementation authority.

## Boundaries

- Never modify workspace files, external state, task control, candidates, plans, or Git state.
- Never infer implementation authority from `pass` or the existence of a proposal. Explicit user authorization already present in the conversation remains valid for the calling task; this review step stays read-only.
- Do not review the review recursively. The review is evidence about the proposal, not a replacement proposal.
- If another skill or the user creates a revised proposal, review that new artifact once when explicitly requested or required by its owning method.
- Do not make this skill an automatic gate for ordinary questions, normal Development, or every technical solution. Trigger only on an explicit challenge request or a direct handoff from a method that requires proposal review.

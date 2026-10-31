# Dynamic code execution and function contracts

Use this topic for executable source, function bridges, validation probes or event binding. Dynamic query and runtime-record CRUD use their own [data contracts](runtime-query-and-object-metadata.md).

Start with the installed package's public contracts and minimal calls. Relevant surfaces include `HttpOrchestrationDefinition`, `IHttpOrchestrationRuntime` and the source/definition validators exported by that version. Maintainers resolve the matching implementation and tests through the AiInfra project entry; its orchestration topic and `AiInfra.Abp.Http.Orchestration` README provide the starting point. A consumer does not need a private checkout to use delivered APIs.

## Connect the affected consumers

Trace the source accepted at save time, any definition or eligibility probe, the selected event binding, function resolution, real execution and final-result handling. Compare the source shape, input model, output model and frozen version at each reached boundary. A helper function's output is not the containing definition's final result; one successful event invocation is not evidence that the definition meets every declared binding requirement.

Use the owning product's current contract for its eligibility rules, event inputs, record identities and Before/After effects. For example, when XRain requires `supportsTrigger` to satisfy both before and after contracts, an after-only `{code:'0'}` result cannot establish full eligibility. This product rule is not a generic requirement for every ordinary function or runtime consumer.

## Distinguish evidence from missing information

| Probe evidence | Development action |
|---|---|
| The real source/input/output violates the applicable contract | Fix the responsible source or mapping; preserve the valid rejection and runtime checks |
| A controlled, side-effect-free case satisfies the contract | Verify the affected save, binding and runtime paths accept the same supported case |
| An external result or optional output model is unknown | Identify the missing contract and supported decision path; do not claim a fabricated return value proves the source valid or invalid |

These are diagnostic distinctions, not instructions to add new public statuses or error codes. A probe that returns `{}` for an unknown function cannot establish the behavior of code reading that function's real fields. Do not bypass existing admission rules or guess successful data to make the example pass. Resolve a material policy gap with its existing owner and continue independent work.

Save and binding probes must not invoke side-effecting external APIs. Pure-function execution, declared models and provider evidence are usable only within their actual guarantees. Preserve the runtime's permission, tenant, frozen-version, size, timeout, cancellation and nested-budget boundaries; validation limits do not prove output semantics.

## Verify and close

Use a legal full-source example with a helper and structured function output, its adjacent invalid source/event/result, and an unknown-external-output case. Check the affected public paths and count external effects to demonstrate probes performed none. Runtime tests still validate actual inputs, final outputs and failure effects. If transactions changed, also use the [transaction topic](transaction-and-failure-semantics.md).

Report the specific accepted/rejected case, the owning contract, actual package version and any unresolved condition. A compile, syntactic check or successful mocked invocation alone does not prove the requested runtime or binding behavior.

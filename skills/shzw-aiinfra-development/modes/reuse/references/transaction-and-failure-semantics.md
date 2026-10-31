# Transaction ownership and failure semantics

Use this topic when changing a write's transaction, savepoint, failure recovery, or post-commit behavior. Reuse the installed UoW/provider capabilities; ordinary reads or unrelated DTO changes do not require a transaction campaign.

## Turn the contract into affected paths

For this task, connect each actual entry and special branch to its database role, transaction owner, error translation and observable final effect. Trace HTTP, SDK, orchestration and special-object routes only where they reach the changed operation. An adapter that opens or commits another transaction is a separate path, even when ordinary records already use the shared manager.

Establish who starts, joins and finally commits the operation. Separate the caller's outer work from this call and its nested effects. Verify the provider's supported savepoint and state-restoration capabilities before choosing partial recovery; unsupported capabilities are a concrete dependency gap, not permission to implement product-side transaction plumbing.

## Follow failures through their consumers

| Failure point | Decision to establish | Evidence |
|---|---|---|
| Business rejection or row constraint | Whether this failure category permits restoring this call and continuing the outer operation | Producer, translator and catcher agree; a valid business code outside the familiar examples behaves correctly |
| Cancellation, lost connection, exhausted budget or failed rollback | The current contract's propagation and remaining transaction usability | These failures do not silently become successful or ordinary per-row results |
| Savepoint rollback | Which database and in-memory effects belong to this call | Restore callbacks, tracked values, mutable UoW state and queued After work without clearing state that preceded the call |
| Commit or later callback failure | Whether data has already committed and which follow-up policy applies | A post-commit failure remains observable and does not cause the original write to be replayed as though rolled back |

Public error text or code is not an internal recoverability category. Do not infer that every exception of one broad type is recoverable either; use the owning contract and provider-confirmed state. Preserve the existing cancellation chain and budget consumption through nested calls. Retry only where the current contract establishes recoverability and idempotence.

## Prove the changed behavior

For savepoint or collection changes, use an isolated real database to observe work before, inside and after the call: a supported caught failure allows the outer work to commit; an outer failure removes all its transactional work; partial results correspond to final successful writes and their After registrations. Include the affected special-object branch and a genuinely unrecoverable counterexample. Read final data through a separate connection after completion; response-only assertions and fake transactions do not prove persistence.

For narrower changes, select only the corresponding failure and postcondition. Use actual candidate packages when public package behavior changed, following [package validation](security-package-validation.md). Record each affected path's result and the specific unverified branch in the task's evidence, without creating another permanent checklist.

AiInfra owns generic UoW, provider and restoration mechanisms. The product owns whether its use case is atomic, whether it exposes partial success, its public response, and any import or workflow policy. Do not turn one product's choice into a shared default.

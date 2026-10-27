# Client Application Development
## Purpose
Use this skill to turn a client request into the smallest verifiable implementation. The main skill owns the method: scope, ownership, delivery choice, lifecycle, evidence, and stop boundaries. Product facts remain in the project's ProductContract/CurrentDesign/Runbook, and platform or distribution details remain in references.

Do not infer a SystemTest or Deployment task from build success, CI, a tag, a candidate, an installer, Git push, or the breadth of validation. A feature, fix, or governance change plus its focused checks remains Development unless the user separately requests an independent test or deployment result.
## Start With The Fast Path
Start at the affected client entry. Use [client-fast-path.md](references/client-fast-path.md) when platform, packaging, runtime or update ownership needs investigation; an ordinary page change does not require the full worksheet.

1. Read the root and project entrypoints, then the smallest formal owner for the requested client facts.
2. Classify this request as Development, SystemTest, or Deployment from the user's goal.
3. Resolve only affected contract fields. A UI change needs the existing UI owner, user action, data/identity contract and completion rule; packaging/runtime/update work additionally needs the corresponding owners below.
4. If an existing product owns the UI, keep that UI as the only visual owner; do not invent a shell page, fallback page, or duplicate interaction.
5. When delivery shape is in scope, choose thin/full/hybrid only from measured payload size, offline requirements, prerequisites, and component ownership.
6. Verify the changed user behavior in its actual consumer. When packaging, runtime or installed behavior changed, also build the relevant candidate and check that exact artifact; do not require a launcher doctor for a web-only fix.
7. Report Development evidence separately from any later SystemTest, Deployment, and Git result.

If a decision changes the outcome, ownership, persisted/public contract, compatibility promise, or external target, stop and expose two or three mutually exclusive choices. Do not stop for discoverable implementation details.

## Minimum Contract
Resolve each field from the authority shown below. Keep working assumptions visible and reversible; never promote them to requirements merely because a reference or earlier plan used them.

| Field | Required question | Preferred source |
|---|---|---|
| Product role | Is this a product, shell, launcher, installer, updater, or managed capability? | User request + ProductContract |
| Visual owner | Which product owns HTML, CSS, routes, and user interaction? | ProductContract + source |
| Platform | Which OS/device/browser and architecture are supported now? | ProductContract |
| Install source | Which installer, package manager, store, or official framework path owns install and repair? | ProductContract + platform reference |
| Runtime owner | Which component owns executable preparation, health, and process cleanup? | CurrentDesign + source |
| Update owner | Which official mechanism updates each independently versioned component? | CurrentDesign + technology reference |
| Distribution | Is this self-use, internal, controlled, or explicit production promotion? | User request + ProductContract/Runbook or distribution reference |
| Recovery | Is post-activation recovery automatic rollback or forward repair? | ProductContract/CurrentDesign |
| Completion | What observable result completes this task? | User request |

When sources conflict, repair the single fact owner before expanding scope. Do not copy project facts into this skill.

## Ownership And Lifecycle

Use one owner per responsibility:

| Responsibility | Owner rule |
|---|---|
| Product behavior and UI | The product that owns the user-facing behavior; a shell must not duplicate it |
| Installer/platform integration | The platform installer, store, or package manager |
| Runtime preparation and process tree | The launcher or native host |
| Update intent and user confirmation | The existing client/manager surface or native shell explicitly named by the contract |
| Release publication | The approved release workflow and immutable source |
| Product data migration | The owning application, only for enumerated mappings |
| Workspace governance | AGENTS, WorkflowContract, StructureContract, TASK_CONTROL, or this skill at their actual owner |

The reusable lifecycle is `discover -> contract -> choose delivery -> build -> verify -> stage -> activate -> recover -> closeout`.

Keep binaries, configuration, credentials, user data, and migrations in separate ownership boundaries. Prepare candidates in temporary state, verify size/digest/provenance and declared health, preserve the current runnable release until activation is safe, and use the contract-selected recovery mode after activation. Never add a fallback origin, compatibility bridge, service, scheduled task, or custom transport-security policy without an explicit owner and requirement.

## Inputs, Search, And Empty States

For inputs, collection pickers and modals, apply the [input, search and empty-state rules](references/ui-surface-design.md#inputs-search-and-empty-states) alongside the project’s UI contract.

## Delivery And Update Decisions

Choose the existing framework/package-manager/platform path before introducing a new shell, installer, updater, runtime, or release stream. Load only the reference that matches the decision:

- [client-contract-template.md](references/client-contract-template.md) for fields, provenance, and owner/source checks.
- [thin-installer.md](references/thin-installer.md) for thin/full/hybrid delivery, component reuse, staging, and activation.
- [technology-and-update-channels.md](references/technology-and-update-channels.md) for stack selection and official update owners.
- [lifecycle.md](references/lifecycle.md) for state ownership, drain, activation, and recovery.
- [managed-runtime-acceptance.md](references/managed-runtime-acceptance.md) when the client owns a private runtime, native modules, a long-lived child process, or a generated bridge.
- [ui-surface-design.md](references/ui-surface-design.md) when the client owns settings, management, forms, lists, search, or other dense user-facing surfaces.
- [platform-windows.md](references/platform-windows.md) for Windows installer, hidden process, WebView2, upgrade, and uninstall behavior.
- [release-and-versioning.md](references/release-and-versioning.md) and [distribution-and-signing.md](references/distribution-and-signing.md) only when release, signing, or immutable publication is in scope.

Do not read every reference by default. The fast path selects the smallest set.

The UI surface reference is a generic supplement. Load it only for a matching client-owned surface, after the project's ProductContract, design system, shared component owner, and page-family guidance are known. It does not import another project's navigation, settings layout, role cards, tables, themes, or component additions; when it conflicts with a project-owned rule, repair or clarify that owner instead of combining both patterns.

## Execution Boundaries

### Development

Implement the requested client behavior and run affected source/type checks and focused tests. Add final candidate doctor and installed-artifact checks only for changes that affect those boundaries. A local installer is a Development candidate, not a public release.

### SystemTest

Run only when the user explicitly asks for an independent integration, system, full-suite, candidate-acceptance, or regression result. Fixes found there require a separate Development authorization.

### Deployment

Run only when the user explicitly names a release artifact and target. Require the deployment workflow's admission evidence, authorization, rollback, and post-deployment checks. OSS publication and production signing are not implied by Development completion.

## Verification Floor

Use [client-verification-matrix.md](references/client-verification-matrix.md) to scale evidence to the changed boundary. Verify the affected contract/owners and source/types/tests. Add final-tree doctor, startup/readiness, process cleanup, state preservation, update, drain, activation or recovery checks only when those behaviors are affected.

按用户主要结果判定验收类型。用户明确要求独立的公开制品、干净机器或故障验收时进入 SystemTest；实现或修复附带的范围匹配检查仍属 Development。正式发布及目标准入沿已授权 Deployment，测试手段本身不新增任务或发布授权。

## Stop Conditions

Stop only the affected path when a required item below cannot be resolved from the user, project owner, source, or the routed reference:

- the supported platform/architecture or installer source is unknown;
- product/UI ownership is ambiguous or the proposed change would duplicate another product's UI;
- runtime, update, or recovery ownership is missing;
- a public or persisted compatibility promise is implied but not owned;
- the requested action would change an external target without explicit Deployment authorization;
- final candidate bytes, installed behavior, or required health evidence cannot be observed;
- a required signature, credential, or platform prerequisite is missing for the selected production/channel contract.

Missing self-use publisher credentials do not block local Development when no production admission requires them; the selected distribution owner defines the exact exception.

## Report And Close

Report the task type, changed boundary, resolved owners, delivery shape, measured artifact/installed evidence, recovery result, unsupported cases, and Git state separately. Use WF-0004 for workspace-changing tasks. Do not create task state, candidates, or permanent documents merely to record this method run.

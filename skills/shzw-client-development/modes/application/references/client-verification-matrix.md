# Client Verification Matrix

Scale verification to the changed boundary. This matrix distinguishes Development evidence from separately requested SystemTest and Deployment evidence.

## Task Boundary And Consumer Evidence

Before continuing or expanding verification, recover the original application/device, environment, target objects, permitted persistent writes and state to preserve or restore. A broader function list changes coverage; it does not by itself lift a restriction to one specified synthetic object. Use that object or an unsubmitted draft for in-scope checks. Create another persistent fixture only when that action is authorized; explicit permission to create isolated fixtures remains valid. Re-read the required state after restoration and report any remaining difference.

Connect each affected user action and rendered state to the actual consumer using existing launch, build and request evidence:

- Identify the selected application/device and the document or route actually open. Attach screenshots to that viewport, data state and observation.
- Trace the loaded page to its built resources or candidate, the native host to its installed artifact when relevant, and a changed API or execution path to the backend/Runtime it actually uses. Version labels alone do not prove this combination; connect build/package identity or digest with the actual resource URL, process/installed path or service read-back, as applicable.
- Reuse evidence for unchanged components. An online-page fix may reuse the existing native package; a newly tested backend feature needs its own consumer/version check. Refresh, restart or rebuild only the affected owner through its existing entry.

Keep this evidence in the current task record; add no product UI, telemetry service or permanent registry for it. A missing required link leaves that result unverified. For a screenshot-only review, identify the supplied image and known source limits without claiming live or installed behavior.

| Changed boundary | Minimum Development evidence | Independent evidence only when requested |
|---|---|---|
| Contract, owner, or routing | source/formal-owner review and one positive/negative scope example | governance or system-wide audit |
| Installer or package graph | clean-output build, package inspection, version/architecture/size/digest checks; exact-candidate startup and affected install/repair/upgrade/uninstall behavior | independent clean-machine/platform acceptance campaign |
| Managed runtime | final-tree doctor, ABI/native-module load, readiness/health, bounded process cleanup | blank-machine bootstrap, source outage, recovery campaign |
| Business Web surface | actual application loads the changed UI; save/read/re-entry and relevant failure or late-result behavior | full browser/desktop regression |
| Native shell or loading boundary | changed installed client loads the owned product surface and preserves identity/state without duplicate UI/IPC | complete supported-platform regression |
| Update and activation | staging preserves current, confirmation/drain boundary, activation health, selected recovery path | repeated upgrade matrix, long-run checks, candidate acceptance |
| Publication | frozen candidate and local read-back verifier | configured source admission, deployment, rollback |

## Positive And Nearby Negative Cases

Choose positive and nearby failure cases for the changed behavior; the following examples apply only to their named artifact/update boundary:

- A valid candidate reaches ready; a truncated, mismatched, or unhealthy candidate remains unactivated.
- The owned business UI loads once; native loading/error/recovery feedback remains available at its project-owned boundary.
- A valid update stages and waits for the declared drain; active work is not forcibly interrupted.
- A final installed executable starts; a worktree/debug-only result is not accepted as installed evidence.
- A permitted source is read exactly; an outage produces a diagnosable failure without an undeclared fallback origin.

## Managed Runtime Checks

When the client owns a runtime, run checks against the final staged or archived tree. Do not rely only on dependency caches, a root-level package marker, readiness log timing, or a generic archive extractor. Verify the runtime's actual entrypoints, native modules, generated files, process tree, and post-staging paths.

## Reporting

Record the exact candidate or installed artifact, environment, versions, component source/outcome, current/staged state, health result, recovery mode/result, and remaining user action. Do not call these results a public release or deployment unless that task was explicitly established.

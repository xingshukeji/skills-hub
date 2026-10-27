# Replicate Workspace

本模式的参考、脚本和资源位于加载结果的 resourceBase.path + "/modes/initialize"。命令工作目录与项目事实由当前责任项目入口确定；相对资源链接按本模式目录解析。

## Principle

Replicate only the operating model. Treat the reference workspace as a source of governance patterns, never as the target's product truth.

Workforce owns the shared workflow and central recovery entry; skills-hub owns reusable skills. For a routed repository, link shared workflow facts to their Workforce owner and install only the needed complete skill directories from skills-hub. Use the target's declared consumption directory; do not leave partial skills or treat the installation path as product source. Keep target-specific product facts and constraints in the target repository.

Keep the agent control plane and human task surface distinct. Replicate a root README and `/人类-文档/` only when the target has at least one verified human task or source entry; link target-owned facts instead of copying reference content.

## Workspace Isolation Gate

Before any write:

1. Resolve and record the canonical reference root and target root. Use `git -C <path> rev-parse --show-toplevel` for Git workspaces and `Resolve-Path` for the final filesystem path. Stop if the roots are equal unless the request explicitly repairs that workspace.
2. Capture scoped `git status --short` baselines for both roots, list the exact target-owned paths, and hash every existing reference file whose relative path collides with that manifest. The reference workspace is read-only during replication; do not use it as a staging area or template scratch space.
3. For every write, normalize the destination and assert that it starts with the canonical target root. For cross-root `apply_patch` on Windows, use absolute target paths with forward slashes; never rely on the process working directory, use relative patch paths while the working directory is the reference workspace, or mix reference and target paths in one patch.
4. Write one small target file first. Immediately assert that it exists under the canonical target root, that the matching reference hash and status are unchanged, and that target `git status` reports the expected path. Only then write the remaining target files.

Keep target creation and reference remediation as separate phases. Complete and validate the target before any reference repair. If an unexpected reference delta appears, freeze further reference writes, preserve concurrent work, and repair only changes attributable to the replication after the target passes or the user explicitly changes the order. Never use reset, checkout, a whole-commit revert, or a commit created after replication began as a substitute for the verified pre-task baseline.

## Minimal Control Plane

```text
<workspace>/
  AGENTS.md
  文档/
    WORKSPACE_STRUCTURE.md
```

For work routed through Workforce, new recoverable tasks remain registered in its central TASK_CONTROL; do not create an empty second register. A standalone target may retain its own task register only when its adopted workflow requires one. Preserve existing registered tasks and their owners rather than duplicating them.

When a real project ID and source root are known, add only `文档/项目/项目_<id>/AGENTS.md` and the category directories required by grounded current documents. Create an Archive or activity directory only when a qualifying fact or recovery task exists. Do not create README inside the governed `文档/` tree, TASKS, relationship indexes or placeholder category files.

When a human surface is grounded, add only the real entries needed now:

```text
<workspace>/
  README.md
  人类-文档/
    README.md
    <task-category>/<task title>.md
```

The root README is the shortest human navigation, `/人类-文档/README.md` is the complete human entry, and task pages link ProductContract, CurrentDesign, Runbook or source owners. Do not create an empty task category or mirror the formal documentation tree.

## Workflow

1. Execute the Workspace Isolation Gate and keep the resolved roots visible in every write operation.
2. Read the reference root AGENTS, task control, structure contract, workflow contract, relevant project entry and validation script. If a human surface is requested, also read its shzw-human-documentation method and navigation pattern. Extract only startup order, task truth, Kind/lifecycle, safety gates, closeout, routing and audience separation.
3. Inspect the target and preserve `.git`, existing source roots, current tasks and user-created content. Never overwrite dirty or concurrent work.
4. Treat control-plane initialization and semantic repair as controlled work, then independently decide persistence. Same-turn work uses the current task plan. Durable recovery updates the sole task register chosen above and, for checker or other technical changes, one Active WF-0002 ChangePlan at the result owner. Require CurrentDesign only when capability-design facts change.
5. Create or repair the minimal control plane using only verified absolute target paths. Declare only real document locations and classify existing content by both authoritative owner and primary consumer, not by filename or reference-workspace layout. Create the human surface only from verified target commands, source entries and facts.
6. Do not seed an unrequested active task. When the reference provides evidence-backed future outcomes, create or update a lazily read WorkInventory without status or execution type; do not invent build, API, UI, database, deployment or source work.
7. Validate the target metadata, Kind/Status placement, Workflow/Action definitions, task/activity bindings, links, materials and UTF-8; run scoped whitespace checks that include untracked target files. Recheck both workspace statuses and all captured reference hashes; fail if the reference differs from its baseline.
8. Execute the target WF-0004. Remove any migration ChangePlan and task only after current facts are reconciled and all triggered checks pass; append one completion fact only when a registered result will affect later choices.

## Boundaries

- Do not modify, stage, commit or push the reference workspace as part of replication.
- Never invent `apps/`, `services/`, `packages/`, `src/`, framework files, lock files, APIs, data models, source roots or a literal root `项目/` source folder.
- Never copy reference product contracts, service names, credentials, connection strings, logs, customer data or generated artifacts.
- Do not retain initialization reports, formal-document README indexes, completed plans or duplicate directory maps. A grounded root README and `/人类-文档/README.md` are the explicit human-entry exception.
- Stop when a path cannot be proven to resolve under the target root, the reference baseline changes unexpectedly, a document owner is ambiguous, an active task depends on content proposed for deletion, or migration would change product/source behavior without authorization.

## Closeout

Report the resolved target root, control-plane files created or repaired, whether `TASK_CONTROL.md` changed, document moves/merges/deletions, target validation results, and whether the reference workspace matched its captured baseline. Report any reference repair as a separate scoped result.

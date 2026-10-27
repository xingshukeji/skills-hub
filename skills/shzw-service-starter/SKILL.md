---
name: shzw-service-starter
description: Use when starting, stopping, restarting, checking, diagnosing, building, or locally verifying workspace services through root package.json scripts for a user-defined Development task or explicitly requested SystemTest task. Trigger for XRain or standalone frontend operations; formal publication, target migration, rollout, cutover, and rollback route to shzw-release-deployment instead.
metadata:
  maintainer: 苏州苏宏助为智能科技有限公司
  source: https://github.com/xingshukeji/skills-hub/blob/main/skills/shzw-service-starter/SKILL.md
---

# Service Starter

Resolve project entrypoints, source, documents and command working directories from the user's target project. Resolve this skill's `references/`, `scripts/` and `assets/` from its installed directory. Locate other responsible repositories through the target project's entrypoint; never infer the target from the skill installation path.

## Rule

Treat root `package.json` as the only user-facing service command registry. Do not invent ad hoc startup commands or expose `.agent/scripts` as the normal entry.

Determine this task's execution type from the user's primary requested result before any state-changing action; do not infer it from the command or environment. In Development, start or restart only the directly affected local service when scoped verification cannot proceed otherwise. In an explicitly requested SystemTest task, use the environment fixed in the current task for temporary execution or the service setup named by the Active durable SystemTestPlan and Runbook. Do not use this skill for formal package publication, target-environment migration, rollout, cutover, or rollback; route those actions to [$shzw-release-deployment](https://github.com/xingshukeji/skills-hub/blob/main/skills/shzw-release-deployment/SKILL.md) and WF-0006.

## Resolve

- `xrain`: XRain, low-code, 低代码, or the default workspace service.
- `frontend-toolchain-smoke`: standalone frontend toolchain app.

With no target, use XRain as defined by root `AGENTS.md`; state the resolved service and task purpose before start, stop, restart, or other state-changing actions. Do not state a project or session current phase.

## Run

From `<WORKSPACE_ROOT>`, prefer the matching `npm run <script>` shown in root `AGENTS.md` and `package.json`. Use the helper to resolve aliases or list current mappings:

```powershell
node "<skill-directory>/scripts/run-service.mjs" --workspace-root "<WORKSPACE_ROOT>" --list
node "<skill-directory>/scripts/run-service.mjs" --workspace-root "<WORKSPACE_ROOT>" --service <service> --action <action>
```

`<skill-directory>` is the installed directory. `--workspace-root` selects the target project; when omitted, the helper uses the current working directory. It never derives the target from its own installation path. On failure, run the matched doctor and then read the project runbook selected by its `AGENTS.md`.

For an unavailable XRain frontend while a candidate owns the backend, use `npm run frontend:xrain:start` (service `xrain`, action `frontend-start`). It reuses a healthy frontend or starts only the managed frontend; it does not rebuild or replace the backend candidate.

When the user explicitly replaces an active local candidate with reviewed main-source work, first use `npm run xrain:candidate:deactivate`. It stops only managed XRain listeners and clears the active candidate receipt; it does not change a database, rebuild main, or authorize the replacement by itself.

## Maintenance

1. Change root `package.json` first.
2. Update `scripts/run-service.mjs` mappings.
3. Update this skill only when routing semantics change.
4. Update the affected AGENTS/runbook entry without duplicating ports or full recovery procedures here.
5. Validate the copied helper with `--workspace-root <WORKSPACE_ROOT> --list` and the affected project command.

## Closeout

Report the command, service status, relevant discovered endpoints/check failure, and actionable follow-up. Do not add a task for transient local process state.

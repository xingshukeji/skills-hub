# Service Starter

本模式的参考、脚本和资源位于加载结果的 resourceBase.path + "/modes/services"。命令工作目录与项目事实由当前责任项目入口确定；相对资源链接按本模式目录解析。

## Rule

Treat root `package.json` as the only user-facing service command registry. Do not invent ad hoc startup commands or expose `.agent/scripts` as the normal entry.

Determine this task's execution type from the user's primary requested result before any state-changing action; do not infer it from the command or environment. In Development, start or restart only the directly affected local service when scoped verification cannot proceed otherwise. In an explicitly requested SystemTest task, use the environment fixed in the current task for temporary execution or the service setup named by the Active durable SystemTestPlan and Runbook. Do not use this skill for formal package publication, target-environment migration, rollout, cutover, or rollback; route those actions to [shzw-delivery](https://github.com/xingshukeji/skills-hub/blob/main/skills/shzw-delivery/modes/deployment/GUIDE.md) and WF-0006.

## Resolve

以下别名仅用于 all_in_one 已登记的服务映射，不是跨项目服务注册表。

- `xrain`: XRain, low-code, 低代码。
- `frontend-toolchain-smoke`: standalone frontend toolchain app.

未指定目标时使用当前项目根入口的默认服务。Workforce 使用统一宿主一键启动；只有目标确为 all_in_one 时才按其入口解析 XRain。启动、停止或重启前说明实际项目与操作目的，不声明项目或会话阶段。

## Run

For .NET CPU, memory, GC, slow requests or database waits, use [service diagnostics](references/dotnet.md). For XRain/AiInfra, also use the [provider and unit-of-work map](references/xrain-dotnet.md). These references guide evidence collection on the identified process; `status` and `doctor` check startup prerequisites and do not establish a performance root cause. Bounded diagnostics remain in the original task.

From `<WORKSPACE_ROOT>`, prefer the matching `npm run <script>` shown in root `AGENTS.md` and `package.json`. 只有 all_in_one 的既有别名才用以下 helper 执行；其他项目直接用自己的根脚本。helper 的 `--list` 只读取所给项目的脚本：

```powershell
node "<mode-directory>/scripts/run-service.mjs" --workspace-root "<WORKSPACE_ROOT>" --list
node "<mode-directory>/scripts/run-service.mjs" --workspace-root "<WORKSPACE_ROOT>" --service <service> --action <action>
```

`<mode-directory>` is the installed directory. `--workspace-root` selects the target project; when omitted, the helper uses the current working directory. It never derives the target from its own installation path. On failure, run the matched doctor and then read the project runbook selected by its `AGENTS.md`.

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

# Release Deployment

本模式的参考、脚本和资源位于加载结果的 resourceBase.path + "/modes/deployment"。命令工作目录与项目事实由当前责任项目入口确定；相对资源链接按本模式目录解析。

## Goal

Change one named target using one immutable, approved artifact and a verified rollback path. Deployment is a user-controlled, always-durable task type with its own authorization and result, not a project/session state or the automatic final step of Development or SystemTest. A work candidate never supplies deployment authority.

## Entry gate

先读目标项目的操作合同。下面的 WF-0006 与持久计划条件适用于采用 Workforce 共同工作流的目标。xrain-cicd、deploy-ops 的正常操作、受管事务、记录及异常恢复门槛继续由其入口持有；不得把通用计划格式叠加为另一审批，也不得削弱其制品、目标、数据保护和恢复边界。

Read root `AGENTS.md`, `文档/工作流/WORKFLOW_CONTRACT.md`, WF-0006, the referenced DeploymentPlan, the matched project `AGENTS.md`, and only the selected deployment Runbook and admission evidence.

Proceed only when all are explicit:

- the user explicitly made deployment to the named target the task goal;
- an independent task whose execution type is `Deployment`;
- an `Active` DeploymentPlan;
- one immutable Artifact and one named Target;
- current user authorization for that Artifact and Target;
- required SystemTest evidence or an explicit authorized waiver;
- a runnable Rollback entry and minimal post-deployment checks.

Do not create the task or plan until Artifact, Target, and current user authorization are explicit. Keep an existing authorized plan Draft and stop when admission evidence or Rollback is pending. Do not infer authorization from a merged change, Git push, successful build, available package, passed tests, or an older deployment request.

## Deploy

1. Verify Artifact identity, Target baseline, admission evidence, secrets by configuration key, operator permissions, change window, and rollback readiness.
2. Read commands and ordering from the target Runbook. Do not reconstruct deploy, migration, publication, or rollback commands from memory.
3. Reconfirm that the command affects only the approved Target and Artifact before each irreversible or externally visible action.
4. Execute the deployment sequence without rebuilding, replacing the artifact, editing product code, or adding unrelated migrations.
5. Run only the minimal post-deployment checks needed to prove the target change and choose between retain and rollback. A broad regression campaign belongs to a separate SystemTest task.
6. On failure, stop or execute the authorized rollback. Preserve sanitized evidence. A product defect or missing candidate evidence blocks this task; create Development or SystemTest only after the user separately authorizes that result.

## Boundaries

制品涉及资源释放、启动或恢复行为时，用[运行稳定性](https://github.com/xingshukeji/skills-hub/blob/main/skills/shzw-testing/modes/stability/GUIDE.md)细化计划中已有的最小部署后检查。固定实例启动时间、背景业务、采样窗口和资源预算，核对原固定身份、代表性业务结果、在途工作及相关资源恢复。空记录读取、短期内存下降或无重启只能证明对应窗口；前后实例年龄和流量不同须注明不可比。已有计划需要回滚时沿原授权执行，不能追加压力或故障注入来补长期稳定性证据。

- Git add, commit, fetch, push, branch movement, and local service restart are repository or development operations, not Deployment.
- Test-environment preparation inside an Active SystemTestPlan is not formal Deployment and must not use this skill unless it changes a declared deployment target.
- Never publish from an ambiguous dirty workspace or substitute a newly built artifact for the approved Artifact.
- Never modify source, tests, plans, or product configuration as an inline deployment fix.
- Never expand post-deployment checks into a system-wide test campaign.
- Missing admission evidence never auto-creates or authorizes SystemTest.

## Closeout

Report `Task type: Deployment`, Artifact, Target, authorization source, admission evidence, exact Runbook, executed actions, target result, rollback result, minimal checks, skipped actions, residual risk, and repository state. Remove the DeploymentPlan and task only after deployment, rollback, or cancellation has a truthful final result and long-lived Runbook facts are reconciled.

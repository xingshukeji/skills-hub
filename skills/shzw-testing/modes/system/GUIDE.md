# System Testing

本模式的参考、脚本和资源位于加载结果的 resourceBase.path + "/modes/system"。命令工作目录与项目事实由当前责任项目入口确定；相对资源链接按本模式目录解析。

## Goal

Produce an assertion-backed conclusion for an explicitly identified workspace or immutable candidate without changing product code or deploying it to a formal target.

SystemTest is a user-controlled task type, not a project/session state or an automatic validation tail of Development. A completed feature, available test command, browser, real database, large suite, or desire for more confidence does not authorize this skill.

## Classify control and persistence

Read root `AGENTS.md`, `文档/工作流/WORKFLOW_CONTRACT.md`, WF-0005, the matched project `AGENTS.md`, and only the selected Runbook and test sources. Read a SystemTestPlan only for durable controlled execution. `WORK_CANDIDATES.md` never authorizes this skill.

First confirm that the current user asks for an independent test conclusion against existing code. A request to implement or fix something and run tests as acceptance remains Development, even when those tests are broad. CI configuration or a release gate describes scope only after the user authorizes this test task.

Use **normal SystemTest** only when all are true:

- the tested subject is the current workspace or another explicitly identified local subject;
- the environment is the current workspace or a user-specified isolated local environment, not shared or formal;
- no immutable release candidate decision or durable campaign evidence is required.

Use **controlled SystemTest** when any normal condition fails, including an immutable candidate, shared test environment, project-managed named test environment, or user-requested CI/release-gate qualification. Fix the user request source, Candidate, Environment, scenario scope, assertions, entry conditions, exit conditions and non-goals before execution.

Then independently choose persistence. Temporary testing has no TASK_CONTROL row or SystemTestPlan, even when controlled; keep its fixed campaign in the current task and report identity, environment, scope and assertions. Use durable recovery for a multi-session campaign, persistent blocker, or shared mutable environment state. For durable controlled testing, proceed only with:

- an independent task whose execution type is `SystemTest`;
- a SystemTestPlan whose `Requested By` records the current user request identifier or verifiable intent summary, never CI, a release gate, or automation;
- one unambiguous Candidate such as a commit, build, package, image, or immutable bundle;
- one named Environment isolated from formal deployment targets;
- scenario scope, assertions, entry conditions, exit conditions, and non-goals;
- plan status `Active` after all entry conditions are fixed.

If request authority is absent, do not create a task or plan. Candidate and Environment must be fixed before any controlled test; do not register `pending` placeholders.

## Run the campaign

用户明确要求负载、长时间运行或故障恢复结论时，读[运行稳定性](../stability/GUIDE.md)选择本次场景、指标、预算与清理动作。固定真实业务比例和数据规模，区分并发登录与已登录业务，覆盖负载撤除及依赖恢复；记录实际完成量、业务断言、失败和未测项。观察时长按本次要覆盖的业务周期确定，不把短时空数据读取写成长期稳定通过。该方法不自动扩大已授权的测试范围。

1. Record the tested subject and verify that the executed code or artifact matches it. A dirty workspace is valid only for normal local testing when it is identified as the subject; never present it as an immutable release candidate. For repeated sampling, follow the [object-change handling](../../SKILL.md#3-执行并核查结果): end the original group on an actual package, build or instance change, preserve its samples and uncertain interval, then bind subsequent sampling to the newly identified subject in a separate group. An initial hash of a mutable directory does not make subsequent execution immutable.
2. Verify environment ownership, credentials by configuration key, data isolation, cleanup boundary, and the selected Runbook. Include shared registrations and the storage they reference; plan their authorized retention, revocation or restoration before stopping a temporary host, then verify the [original-entry recovery result](../../SKILL.md#4-回核并报告) after the Runbook's handback steps.
3. Execute only the approved campaign. Use existing runners and reports; do not create a parallel harness unless the task explicitly includes test infrastructure development.
4. Assert observable behavior and material side effects. Separate product assertions from environment, credential, startup, migration, fixture, and runner failures.
5. Keep the tested subject read-only. On a product or test implementation defect, retain the minimum reproduction and stop the affected campaign path. Fixes belong to a separately authorized Development result; use repair authority already present in the request instead of asking again. Without that authority, report the needed repair while continuing unaffected authorized testing.
6. For controlled testing, rerun against a new Candidate only after the authorized repair is verified and the fixed test subject is updated in the current task or existing SystemTestPlan. Never silently substitute the artifact or create a durable plan for temporary testing.

## Boundaries

- Preparing an isolated test environment from the Candidate is allowed; publishing a formal package or changing a production/staging deployment target is not.
- Do not edit product source, test source, migrations, fixtures, or configuration tracked by the product during the campaign. Such changes belong to Development.
- Do not turn Development evidence into SystemTest because it uses integration boundaries, a browser, real database, real service, multiple roles, or a large suite. Test scope and environment are execution inputs, not substitutes for the user's explicit test goal.
- A passing controlled candidate campaign may provide evidence for a later Deployment task. Neither normal nor controlled testing creates or authorizes Deployment.
- An unavailable environment means SystemTest evidence is unavailable. It does not reverse a previously completed Development result.

## Closeout

Report `Task type: SystemTest`, control strength, persistence, tested workspace or Candidate, Environment, selected scenarios, exact commands or runners, assertion results, environment failures, skipped scope, retained safe evidence, and residual risk. Report deployment eligibility only for a controlled candidate campaign. Remove a durable SystemTestPlan and task when its candidate receives a final conclusion. Keep defect records separate from repair execution; any already authorized repair continues under its own result and scope. Do not run deployment or imply deployment authorization.

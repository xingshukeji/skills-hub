# Git 收口

本指南把已验证的独立结果提交到目标仓库的当前分支并推送。Git 收口不改变功能结论，也不授权发布应用包或部署服务。目标仓库、分支和必要验证由用户请求与项目入口确定；本目录提供收口工具。

通过 node scripts/run-git-closeout.mjs 执行本指南中的同步、git add、git commit 和 git push。工具使用具体文件路径；默认操作当前主 checkout 的 origin/main。只有用户明确要求已有的其他分支或已有 worktree 时，才传入 --branch 或 --allow-linked-worktree。

## 先确认范围

1. 完成用户要求、必要验证和实际存在的活动任务清理。验证后如果并行改动影响本次文件、直接依赖或断言，先补跑受影响验证。本次候选的验证失败或必需验证未运行时，停止 Git 写入。
2. 列出本次实际创建、修改、删除或重命名的文件，包含属于本次的最终任务登记调整。逐文件查看差异；普通路径提交只选择全部改动归本次结果的文件。
3. 排除秘密、凭据、日志、未获许可的生成物、依赖目录和智能体运行状态。遵循责任项目明确声明的例外。
4. 分别传入每个文件的 --path。文件名按字面处理，不传目录、通配符或仓库根目录。重命名同时传入原路径和新路径。
5. 如果一个文件混有其他工作的改动，不得将工作文件整体当成本次归属。能从当前基线构造只含本次改动、依赖完整的候选并验证时，可按下文使用候选 tree；否则只交付其他可独立验证且完整归属的文件。工具不自动判断或拆分修改归属。
6. 如果用户禁止提交或推送，遵循该明确要求。

## 处理共享工作目录

| 情况 | 动作 |
|---|---|
| 其他会话的无关文件已修改或暂存 | 保留其状态；使用明确文件路径继续。 |
| 本次文件已有暂存内容 | 核实该文件的暂存和工作副本全部属于本次且已验证后，传入 --include-staged-owned；否则保留现场并停止该范围。 |
| 所选文件的归属无法确定 | 停止该范围；不取消其他会话的暂存，不猜测归属。混合文件中的本次内容可独立核实且依赖完整时，使用经验证的候选 tree。 |
| 本地有较早的未推送提交，远端是其祖先 | 可以提交当前已验证且完整归属的文件。工具等待前一个提交由其责任方推送后，再推送本次确切提交。 |
| 工作文件无差异，但本地有未推送提交 | 不把它报告为无变更完成。核实提交 SHA、完整差异、归属和验证后，用 push-commit 接续本任务的确切提交。 |
| 全仓检查因其他会话尚未完成的改动失败 | 先核实失败归属及依赖。若本次结果能够独立验证，使用下述候选快照运行同一必要检查；同时报告共享工作目录的失败。若两者无法分离或项目要求检查共享集成状态，停止收口。 |
| 远端领先且可以安全快进 | 工具自动获取并快进，然后返回 `synchronized_recheck`；检查上游变化并重做受影响的验证，再继续收口。 |
| 快进被重叠的未提交文件拦住 | 逐项比较原基线、本地文件和远端。若所有远端变化均在已修改的现有文件，且已确认保留本地工作文件与上游基线的差异，可按下文使用 `sync-preserve`；否则保留现场，按实际冲突恢复，不覆盖或提交其他工作。 |
| 历史分叉，或仓库正在合并、变基等 | 保留现场并停止；不自动变基、暂存、重置或强推。 |
| 本地和远端均无提交，且远端没有任何分支 | 允许精确创建首个提交；推送前再次检查远端仍为空。 |
| 提交后钩子或并行操作改变了预期内容 | 保留本地提交并报告 SHA；不推送该提交。核对实际差异及验证，不自动改写历史。 |

工具通过 Git 的路径提交隔离无关暂存，并在提交后核对文件、内容和父提交。新文件会先以 intent-to-add 形式登记；提交失败时该标记可能保留，但文件内容不会因此完整暂存。工具不会删除其他进程的 Git 锁。碰到锁时默认等待至多 15 秒；--wait-seconds 可设为 0 至 60。

路径提交会读取所选文件的整个工作副本。--include-staged-owned 同样提交整个文件，而不是只提交已暂存的片段。它不能解决同文件同时编辑的归属问题。提交钩子也可能修改暂存内容；提交后核对发现变化时，本地提交已经存在，但工具不会推送它。

## 执行与接续

下面示例使用 Workforce 的安装路径。其他仓库使用其入口声明的完整支撑目录：

~~~powershell
node .agents/support/shzw-git-closeout/scripts/run-git-closeout.mjs --mode commit-push --repo . --message "chore: improve shared checkout closeout" --verification "focused tests; npm run check:docs; scoped diff check" --path .agents/support/shzw-git-closeout/GUIDE.md
~~~

--mode check 检查路径、暂存重叠和远端状态，不提交或推送。结果中的 pendingParentCommits 表示当前分支还有较早的本地提交；它不证明这些提交可以由本次任务推送。

### 同步后继续

`commit-push` 遇到远端单向领先时先尝试 Git 安全快进。成功后只返回 `synchronized_recheck`，不创建提交；检查远端变化及其对本次结果、直接依赖和断言的影响，重新完成必要验证后再次运行。也可用 `--mode sync --verification "准备同步后复验"` 单独同步。`check` 保持检查用途，不修改分支。

普通快进因未提交内容被拒绝时，不要以“远端领先”为由结束任务。先查清所有远端改动与本地文件的关系。若每个远端改动都是已有文件的修改，且每个文件均有本地未提交修改、没有重叠暂存，并已逐项确认可以保留当前文件内容，可将所有这些路径分别传入 `sync-preserve`。工具核对完整路径集合、文件类型、分支和索引，在不改写工作文件及无关暂存内容的前提下前进基线；运行时若现场变化则停止。

~~~powershell
node .agents/support/shzw-git-closeout/scripts/run-git-closeout.mjs --mode sync-preserve --repo . --verification "逐项核对原基线、本地和远端，保留本地工作文件" --path path/to/reviewed-file --path path/to/another-reviewed-file
~~~

此处的路径是同步时核对过的文件，并不表示它们归本次任务。远端内容存在新基线中，本地文件相对新基线的差异仍未提交；同一处的不同修改仍需由对应责任方核对，不能当成已自动解决。不能接受保留现有文件、远端有新增或删除文件、路径未核对完整、重叠文件有暂存内容，或历史分叉时，不使用此模式。同步后核对工作区，检查上游对本次候选的影响并重做必要验证，再按原归属选择文件。该模式不提交或推送任何内容。

### 验证确切候选

如果其他会话的无关改动阻断全仓检查，先用 snapshot 生成仅包含当前 HEAD 和本次所选文件的 Git tree。该操作不修改共享暂存，也不创建提交。它返回 base、tree 和实际变化文件；检查路径和归属后，从该 tree 导出普通临时目录，不创建 Git worktree。

~~~powershell
node .agents/support/shzw-git-closeout/scripts/run-git-closeout.mjs --mode snapshot --repo . --path path/to/owned-file
~~~

在导出的候选上使用项目要求的工具链和完整必要检查。检查通过后，向 commit-push 传入返回的 --expected-tree 值。工具在提交前与提交后核对整个 tree；内容或基线发生变化时停止，不推送未验证候选。需要接续已有提交时，push-commit 也可以传入该值。

可以使用 git archive 导出固定 tree。验证需要 Git 历史时，向测试只读提供原仓库的固定 base 及其必要历史，确保历史读取不会修改原仓库或改变候选内容。如果无法提供兼容的历史输入，继续能做的检查，并报告未通过的检查；不得把普通导出目录伪装成完整 Git 仓库。

候选检查只证明这个 tree，不证明共享工作目录或其他任务已通过。若本次修改依赖其他尚未提交的内容，不能排除它们来制造通过；先完成相关结果及验证。

### 混合工作文件中的独立候选

当工作文件还含其他任务的修改时，可以将当前基线与已核实属于本次的内容构造成普通候选目录；这不是 Git worktree，也不更改共享文件。逐项审阅候选相对基线的完整差异，确认没有混入其他任务，且没有排除本次所需的未提交依赖。候选目录必须提供每个选中路径的完整文件；此入口不自动处理删除。

使用 `--source-root` 从候选目录生成 tree，导出并对这个确切 tree 完成必要检查；任何基线、文件或依赖变化后重新生成并验证。下例将 `BASE` 和 `TREE` 替换为 snapshot 返回的完整值，并传入所有变化文件：

~~~powershell
node .agents/support/shzw-git-closeout/scripts/run-git-closeout.mjs --mode snapshot --repo . --source-root C:/candidate --path path/to/first-file --path path/to/second-file
node .agents/support/shzw-git-closeout/scripts/run-git-closeout.mjs --mode commit-tree --repo . --expected-base BASE --expected-tree TREE --verification "已审阅并验证该完整 tree" --message "fix: preserve baseline permissions" --path path/to/first-file --path path/to/second-file
~~~

`commit-tree` 要求当前 HEAD 等于已验证基线，tree 相对基线的变化文件与路径清单完全一致，且选中路径无暂存内容。它运行原生提交钩子、核对提交 tree 和父提交，并保留工作文件与无关暂存；提交后这些文件相对新基线仍可能有其他任务的未提交差异。钩子或并发改变候选、父提交或工作文件时不会推送，保留实际提交并报告 SHA。这个入口不是免审的分块提交；审阅、归属和验证由任务负责人完成。

如果当前任务的确切提交已经存在，先确认该提交的所有修改都属于本次且已经验证。将示例中的 FULL_SHA 和路径替换为确切值；多文件分别传入 --path：

~~~powershell
node .agents/support/shzw-git-closeout/scripts/run-git-closeout.mjs --mode push-commit --repo . --commit FULL_SHA --verification "verified this commit and its exact owned paths" --path path/to/owned-file
~~~

push-commit 只推送该 SHA。推送前，远端分支顶端必须等于该提交的父提交；远端已经包含该 SHA 时直接回读成功。工具不会为推送本次提交而一并推送尚未授权的较早提交。

## 解释结果

- 退出码 0：pushed、ready、snapshot、skip_no_changes、already_synchronized、synchronized_recheck 或 synchronized_preserving_working_files。同步和快照只是预备结果，需要继续核对及验证。
- 退出码 2：提交前停止，例如选中路径的暂存未明确归属、路径被忽略或远端领先。
- 退出码 3：本地提交可能已经存在，但身份、内容、父提交或推送核对没有完成。保留并报告返回的 SHA 或候选 SHA，不猜测归属。
- 退出码 1：参数错误或异常。

parent_not_published 表示本次提交已保留在本地，前一个提交尚未由其责任方推送。确认前一个提交已在远端后，可以用 push-commit 接续，不必重复创建提交。commit_scope_changed、commit_base_changed 或 verified_tree_changed 表示结果与核对或验证的内容不一致；先检查实际状态，不得直接重试推送。

skip_no_changes 只在选中路径无工作副本差异且本地和远端一致时返回。Git 受阻只影响 Git 状态，不反转已确认的功能结论，也不因此保留已完成的活动任务。

## 验证方法

维护 scripts/run-git-closeout.test.mjs。测试至少覆盖明确文件提交、验证 tree 的混合文件交付、无关暂存保留、选中路径暂存拒绝、并发提交、等待父提交和接续指定 SHA、钩子更改内容、忽略文件、空远端初始化、安全快进、重叠文件保留与拒绝以及真实推送拒绝。验证工具自身修改时，运行该测试、技能校验、项目要求的文档检查及本次文件的差异检查。

路径提交思路参考 [Beryl 的多智能体 Git 技能](https://github.com/berylorg/beryl/blob/main/.agents/skills/multi-agent-vcs/SKILL.md) 和 [Git commit 文档](https://git-scm.com/docs/git-commit)。这些来源不能代替本仓对提交钩子、共同索引和推送后状态的实际验证。

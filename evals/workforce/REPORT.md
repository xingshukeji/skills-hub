# Workforce 运行类 skill：问题依据、实现与验证

本页保留**首轮实验**的范围与结果。第二轮已经合并两个入口并补齐领域契约；当前目录、独立性判断与验证见 [能力边界复核](CAPABILITY-AUDIT.md)。本页九项及其分数不代表当前七项已经覆盖全部业务场景。

本次在 skills-hub 的 Local checkout 优化原有 `cicd`、`xrain-auth`、`xrain-cli`，新增 6 个运行类 skill。重点是已有环境中“启动、登录、安装、操作、验证”的连续处理，减少重复询问、错误重试与没有业务证据的完成声明。没有修改六个业务项目、运行生产变更或安装到现有员工配置。

## 对话覆盖与判断依据

检索本机可读取的六个项目共 **459 条对话**，其中 **227 条已归档**，提取 **3,159 条 user-role 消息**。时间范围为 UTC 2026-08-02 至 2026-10-22。按启动环境、身份权限、发布安装、测试验收、智能体、性能、数据、网络及质问纠正等维度检索，再对相关运行场景和近期纠正逐条复核。

| 项目 | 对话 | user-role 消息 |
| --- | ---: | ---: |
| Workforce | 241 | 1,648 |
| OAuth | 40 | 281 |
| CI/CD | 12 | 96 |
| App Exchange | 12 | 26 |
| Harness | 17 | 65 |
| all_in_one（低代码平台所在项目） | 137 | 1,043 |

已排除子代理、环境说明等外围内容及 3 条可识别的自动生成提示。user-role 中仍可能包含用户粘贴的 AI 文本或任务转发，不能将总数当作独立人工诉求数量。关键词用于召回，不作为问题发生率统计。覆盖限于本机可读取的项目历史；未声称覆盖未接入主机，也未逐字审阅全部助手回复。原始历史、敏感信息和检索中间文件保留在 ignored `.local-validation/`，不进入 Git。

以下为关键证据的简要摘录或概括，日期为 UTC；对话 ID 用于在原项目追溯，不将 AI 的完成声明当成实际完成：

| 日期 / 项目 | 用户反馈与后续判断 | 对话 ID |
| --- | --- | --- |
| 10-22 / Workforce | “启动开发环境、启动服务、调试等，都是默认启动这个”；默认开发须连接服务器并完成浏览器使用验证 | `01a163b4-7f51-71f0-a6b6-9163bc9458f5` |
| 10-22 / Workforce | 已取消三份个人接入包；多人分别本机运行，使用共享测试租户。近期明确纠正优先于旧拓扑 | `01a15c3f-f991-7f31-b2df-acf42b3219aa` |
| 10-17 / OAuth | 测试环境已部署却无可用账号，随后要求从浏览器验证新环境使用缺口 | `01a14a3a-cbd8-75f0-a815-1ba85c153a0c` |
| 10-16 / CI/CD | “我点击发布报错啊——这里还没完成啊”；构建结果不能替代发布和部署结果 | `01a13ebd-69c6-79b3-ab54-1173d245968e` |
| 09-28 / App Exchange | 要求从终端认证、应用发布到消费流程完整跑一次，保证用户能安装使用 | `01a0e8ac-df2b-7e21-8632-f60baf4455c0` |
| 09-22 / Workforce | 消息入口缺已注册执行权限、实际 403，用户追问“之前你做过的”；需要查初始化和授权链，而非临时加权 | `01a0c7a3-04f1-7070-b492-d313a3e3e1b2` |
| 09-22 / 低代码 | 建立消息机器人后提示 15 项能力缺权限，却无法知道缺哪个权限集 | `01a0c94e-f62c-79e2-9520-cf2c1a6b4e46` |
| 10-16 / 低代码 | 反问普通用户被元数据管理接口拒绝是否本来就合理；需要区分正确拒绝与实际授权缺口 | `01a142f9-2baa-7242-8a52-aa2c78632ba0` |
| 10-14 / Workforce | 服务已启动仍可能是智能体用户无权使用；要求所有功能在内置浏览器中验证 | `01a13844-3451-7663-a3ee-7944f28e3582` |
| 09-28、10-01 / Workforce | 页面打开超过两秒、新会话慢、切换智能体慢；要求看实际交互效果 | `01a0e899-43be-7621-9d5f-98bf6850d81c`；`01a0f223-c6a7-7ed0-90ce-73962481c67d` |
| 09-20 / Harness | 要求真实模型请求和工具调用验证；后续运行排障必须区分模型回答、工具结果与业务交付 | `01a0bee9-9165-7922-9d19-b46767185ccf` |
| 08-22、09-08 / 低代码 | 重复初始化是否能解决根因；安装应先校验、失败需处理恢复，不能默认删除重装 | `01a027cb-6449-78f2-874a-46a3ff56f72f`；`01a07ed0-86ef-7e43-96eb-97e794d7f313` |

## 已实现的处理能力与触发用语

以下用语是自然语言触发示例，不要求逐字匹配；选择还取决于当前任务上下文和可用工具。

| Skill | 解决后续处理中的什么问题 | 常用触发用语 |
| --- | --- | --- |
| [workforce-runtime](../../skills/workforce-runtime/SKILL.md)（新增） | 统一默认启动；沿浏览器、代理、宿主、Runtime、平台、认证和模型定位；核对部署制品与实际实例 | “启动开发环境”“调试一下”“服务就绪了还是不能用”“部署后还是旧效果” |
| [xrain-access-diagnosis](../../skills/xrain-access-diagnosis/SKILL.md)（新增） | 区分身份、成员、准入、执行能力、对象/字段/记录权限；不以管理员绕过验收 | “登录后还是 403”“新用户为什么不能用”“消息机器人到底缺哪个权限” |
| [xrain-app-operations](../../skills/xrain-app-operations/SKILL.md)（新增） | 区分市场上架与租户安装；处理预检、绑定、冲突、升级及断线后的原操作恢复 | “发布了怎么还在用旧版”“帮我安装这个应用”“升级卡住了”“安装超时继续处理” |
| [workforce-agent-troubleshoot](../../skills/workforce-agent-troubleshoot/SKILL.md)（新增） | 关联任务、会话、工具和业务交付；处理等待输入、重复执行、切换不生效及接管后的旧执行 | “AI 怎么不回复”“任务没有继续跟进”“加载 skill 还不能执行命令”“人工接管了还在写” |
| workforce-verify（首轮新增，现已合入 [runtime 验收](../../skills/workforce-runtime/references/acceptance.md)） | 从真实用户浏览器入口验证操作、持久结果和相关权限边界；分清未执行与通过 | “内置浏览器完整验收”“功能到底能不能用”“修复后继续测”“安装后完整跑一遍” |
| workforce-performance（首轮新增，现已合入 [runtime 性能](../../skills/workforce-runtime/references/measurement.md)） | 测量用户可见耗时；分开冷热和前后台；保留失败样本，避免少量快请求得出达标结论 | “页面打开超过两秒”“新会话很慢”“切换智能体卡”“分析这份性能采样” |
| [cicd](../../skills/cicd/SKILL.md)（优化） | 查询或触发真实已有流水线，跟踪本次回执、完整发布参数与终态；未知提交不盲重发 | “触发测试发布”“查这次构建结果”“刚才部署断线了继续跟踪” |
| [xrain-auth](../../skills/xrain-auth/SKILL.md)（优化） | 原身份复用、激活和授权恢复；区分中心认证、客户端登记及原应用接入 | “固定账号登录不了”“需要激活”“invalid_client”“验证这个密码能否登录” |
| [xrain-cli](../../skills/xrain-cli/SKILL.md)（优化） | 使用自带 CLI 完成受支持的查询、数据、权限与包操作；减少重复预检，保留租户和会话边界 | “用 CLI 查客户数据”“查看用户角色”“构建并发布这个应用包” |

明确的业务 403 优先定位授权层；服务未监听优先运行排障；已有 operation 的安装问题优先恢复原操作。登录密码与 OIDC 失败由认证 skill 处理。只要求写文案或设计技术架构时，这组运行 skill 不应被误选。

每个 skill 仅依赖自己的目录。详细契约按需加载，脚本及参考路径使用 Workforce 的 `resourceBase.path`。目录可见、skill 已加载、员工获准使用命令/浏览器是不同条件，不能自动扩大 `nativeTools`。既有授权继续有效；只在缺少必要信息、本人输入或超出原范围的具体影响时交回决定。

性能 skill 自带本地汇总脚本，验证过失败、超时、取消、冷热/前后台分组、预算一致性及独立复制执行。脚本不访问服务、不创建任务、不发消息。

## 与当前实现核对的运行契约

读取六个项目的现有实现后，只把执行必要的事实放入 skill；使用端不要求这些源码仓库在本机：

- Workforce 当前根启动入口及 `.workforce/development-launch.json` 的字段、进程归属与状态保留行为；依据 `RUN-0011-默认开发启动.md`、`Start-Development.ps1`。
- Workforce `tasks/host/routes.mjs`、`workbench/host/routes.mjs` 的任务执行会话、会话历史与待输入查询入口；员工工具策略实际受 `nativeTools` 和业务工具配置限制。
- 独立市场的目录、发布及独立会话；平台安装、预检、operation、revision、绑定和确认使用平台自己的受管契约。
- 低代码 `ApplicationPackageContracts.cs`、`ApplicationPackageApiEndpoints.cs`、`ApplicationPackagePolicy.cs` 的路径、请求与状态。`Succeeded` 才是成功终态，绑定/冲突等待使用 `WaitingForResolution`。
- 安装 `/check` 为 `CurrentActorObjectReadOnly`；非业务对象可能 `NotChecked`，不能外推其他用户、写操作或消息交付已验证。
- 业务管理接口的认证方式限制、应用 admission/publication-scope/execution-authorization 与有效权限层。
- Harness 当前 `dsh-skill-filesystem` 和 `dsh-tool-skill` 为 `0.1.7-rc.2`；默认目录描述截断长度为 500，资源加载返回独立目录路径。

读取时各项目 HEAD 为：Workforce `389c22e`，OAuth `11e6e74`，CI/CD `aba98d6`，App Exchange `5f9d250`，Harness `8c3254c`，低代码 `79ff176`。这些是维护时的追溯信息，目标运行实例的契约仍须以实际部署为准。

## 验证与效果

### 原有三个 skill 的 A/B

基线提交 `aa8b1966559702ee07a319983fada12ed79e1c06`。24 个固定观测决策题，两个独立重复；每次随机分配盲化组，选项顺序对两组保持一致。评估代理只能读取本组目录，不接触预期答案。快照、案例、目录、指令和回答均记录 SHA-256，评分拒绝输入漂移、缺答或重复答案。

| 指标 | 原版 | 新版 |
| --- | ---: | ---: |
| 选择正确 skill | 48 / 48 | 48 / 48 |
| 下一步决策正确 | 48 / 48 | 48 / 48 |
| 两项同时正确 | 48 / 48 | 48 / 48 |
| 三个 SKILL.md 合计字符 | 7,762 | 4,247 |

新版入口字符减少 **45.3%**。单项为 cicd 2,085→1,023，xrain-auth 1,866→1,397，xrain-cli 3,811→1,827。字符统计包含 frontmatter，不是 token、调用次数或耗时测量。

本次没有测出正确率提升；这组选择题存在满分天花板，只能说明缩短入口后未观察到决策回退。新增六个 skill 扩大了覆盖范围，不能把原三个入口的压缩比例说成整个九项目录的上下文缩减。

### 前向场景与执行检查

无选项回放覆盖 20 个场景，分别由两个隔离代理回答；包括原目录与新增 skill 的交叉选择，以及技术设计、文案请求等不应触发项。性能案例实际执行复制目录中的脚本。评估器只验证输入完整和回答齐全，主代理按 [首轮 rubric](results/first-forward-rubric.json) 逐项复核语义，不用关键词匹配伪装行为验证。[首轮输入](results/first-forward-cases.json)保留原路由名称，当前 forward 输入已随合并调整。

最终两组均为 **20/20 路由正确、20/20 行为要求满足**，合计 **40/40**。逐项结果和证据见 [results.json](results.json)、[第一组回答](results/forward-group-1.json)和[第二组回答](results/forward-group-2.json)。这是主代理对独立回答的语义评审，不是额外的人类验收。早期演练中发现测试夹具使用了非实际安装状态名称，已按源码修正为 `WaitingForResolution`，补充真实状态表并重新运行最终两组；不将旧夹具轮次计入最终成绩。

其余验证结果：

- `npm run check`：构建制品一致性、九项 skill 结构/索引、**105 项自动化测试全部通过**。
- `quick_validate.py`：九项全部通过。
- 真实 Harness 文件加载器：九项分别复制到带空格临时目录，逐项发现和加载成功，参考文件均可解析，未借用其他 skill 目录。
- 新增评估器测试拒绝缺答、重复、未知 skill、快照和输入漂移；它们的合成答案仅验证评分器，不计入 skill 效果成绩。

这是离线决策回放、脚本执行与真实加载器兼容验证。没有在真实 Workforce 模型会话中完成全部业务链路，也没有重跑历史 77 项 live 验收；因此不宣称生产故障已修复、生产成功率提高或业务端到端通过。

## 复现

以下命令可针对当前目录执行同种方法的新实验；不能把当前七项的运行称为首轮九项快照的精确复现。首轮回答、输入、评分规则与摘要已保留，原执行快照留在本机 ignored 目录。

在仓库已有维护依赖的情况下执行，输出目录必须是新的目录：

```text
npm run eval:prepare -- --output .local-validation/skill-ab/new-run --baseline aa8b196 --repeats 2
```

分别让无前文的独立评估代理只读各 `group-*` 中的 `instructions.md/catalog.json/cases.json/skills`，仅写本组 `answers.json`；不要提供评分标准或版本映射。然后：

```text
npm run eval:score -- --output .local-validation/skill-ab/new-run
npm run eval:forward -- --output .local-validation/skill-forward/new-run --repeats 2
```

前向代理只读各组 `input/`，按其说明输出本组 `answers.json`，可执行本组提供的汇总脚本。之后运行结构核验，再按私有 rubric 逐项评审行为：

```text
npm run eval:verify -- --output .local-validation/skill-forward/new-run
npm run verify:workforce -- --provider <已安装的dsh-skill-filesystem/lib/index.js>
npm run check
```

`verify:workforce` 只读取维护者明确指定的加载器，不下载依赖、不改目标配置。要在 Workforce 采用这些 skill，仍须由其现有安装与工具授权机制装配；本次已完成技能目录交付及兼容验证，未改现有员工权限。

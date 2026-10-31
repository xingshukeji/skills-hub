# XRain CLI 连接与智能体使用设计

Status: Active
Kind: CurrentDesign
Scope: skills-hub / xrain-cli 的平台连接、智能体入口与身份诊断
Owner: skills-hub 维护者
Updated: 2026-10-31
Depends On:
- ../../AGENTS.md
- ../../skills/shzw-xrain-cli/SKILL.md

本文记录已批准的连接设计与源码实现。`profile` 智能体配置、`auth whoami --agent` 及 Runtime 本人身份接口已在对应源码实现；实际部署和已安装 Skill 是否包含这些能力，以所用版本为准。

## 用户结果与现状

使用者安装完整 Skill 后，通过 CLI 配置目标并登录。使用者可以查询当前身份，再按实际权限管理智能体定义、个人订阅和应用选用，并发起、继续和回读对话。平台、租户、智能体入口与使用身份由同一连接配置表达。使用者不需要读取开发仓库或编写登录脚本。

`auth login` 的浏览器和设备方式从平台取得登录配置；原生账号方式直接使用平台原生登录接口。成功后均保存租户会话。`auth whoami` 向平台查询实际用户和租户。profile 可保存平台地址、租户、Runtime 地址及默认应用 ID；智能体定义与对话也保留单次 `--runtime` 覆盖。CLI 将所选平台凭据发送到 Runtime。平台的智能体订阅和应用选用仍使用平台地址。

本机开发配置中的 `http://127.0.0.1:15380` 是该开发组合的统一宿主地址。它不是 CLI 登录的返回值，也不是其他使用者的默认地址。平台现有 CLI 登录配置和应用列表没有提供客户端可用的 Runtime 地址。平台的定义目录地址用于其自身目录读取，不能当作各客户端的执行入口。

## 入口来源与连接配置

| 选择 | 用户操作 | 依据与影响 |
|---|---|---|
| 推荐：在 profile 中配置智能体入口 | 首次从实际服务所有者的接入信息取得可访问地址，并保存一次；后续命令复用 | 沿用现有 CLI 连接配置和登录；不引入平台地址登记服务。地址变化时由使用者更新相应 profile。 |
| 平台自动发现 | 登录后从平台取得与用户、应用和运行实例匹配的执行入口 | 当前平台合同未提供该信息。要实现此选项，需要另行确定公开地址的所有者、登记和多实例选择合同。不能将平台已有的内部目录地址直接暴露或当成执行地址。 |

推荐方案允许使用实际应用宿主对外提供的 Runtime 入口。只有该宿主确实开放所需接口时，应用网址才能用作该入口。CLI 不根据平台域名、应用名称或固定端口猜测地址，也不把本机开发地址设为通用默认值。缺少入口时，智能体运行命令提示配置；平台命令仍可使用。

profile 支持可选的 Runtime 地址和默认应用 ID。默认应用 ID 为空时使用个人上下文。多个环境或不同 Runtime 使用不同 profile。显式 `--runtime` 和 `--application-id` 保留单次覆盖能力。`--personal` 供适用命令在本次请求中选择个人上下文；`profile set --personal` 清除已保存的默认应用。`agent directory --mine` 始终使用个人上下文。

地址解析顺序为命令显式参数、当前 profile 中的对应字段。只有有效的平台地址与租户和该 profile 保存的目标一致时，才复用 profile 的 Runtime 和应用配置。若单次命令切换平台或租户，应显式提供对应 Runtime，或选择对应 profile；不能把原目标的地址静默用于新目标。订阅和订阅审批始终使用个人订阅语义。应用选用的管理命令继续使用明确的应用 ID。

`profile set`、`profile show/list`、`auth status` 和帮助文本处理并展示新的非秘密配置。当 `profile set` 修改平台或租户时，CLI 清除没有同时重新指定的旧 Runtime 和应用关联。成功登录同一平台与租户时，`auth login` 保留该 profile 的 Runtime 和应用配置；登录到不同平台或租户时，清除旧关联并提示重新配置。`auth logout` 继续保留 profile，`profile remove` 沿用现有删除语义。地址不是凭据，不存入登录会话；会话保护方式保持不变。

以下命令需要包含本次实现的 Skill 及支持身份检查的 Runtime：

```text
xrain-cli profile set --server <平台地址> --tenant <租户ID> --runtime <智能体入口地址>
xrain-cli auth login
xrain-cli auth whoami --agent
xrain-cli agent definition options
xrain-cli agent definition create --name <名称> --values-json <定义文件>
xrain-cli agent definition enable <agentId> --expected-revision <版本>
xrain-cli agent policy set <agentId> --visibility public
xrain-cli agent directory --mine
xrain-cli agent subscribe <agentId>
xrain-cli agent chat start <agentId> --message <问题>
xrain-cli agent chat send <sessionId> --message <后续问题>
```

应用场景可以通过 `profile set --application-id <应用ID>` 设置默认应用，也可以在适用命令上显式提供 `--application-id`。管理者按实际权限创建并启用定义、设置订阅策略或配置应用选用；这些动作不会自动为使用者订阅或批准申请。普通用户沿本人订阅资格使用个人入口。

## 登录与身份诊断

复用平台浏览器或设备登录，以及平台租户会话。对于平台原生租户账号，`auth login --native --user <账号> --password-stdin` 从标准输入读取密码，并通过平台原生登录接口取得同一种租户会话；不接受命令参数形式的密码。保持现有凭据选择顺序；`auth status` 和 `auth whoami` 展示实际凭据来源。如果环境变量中的凭据优先于已保存会话，使用者可以显式选择 `--auth session`。命令不输出凭据。

普通 `auth whoami` 继续查询平台实际用户和租户，并展示已配置的智能体入口和应用上下文。配置展示不表示 Runtime 已连接或应用已授权，不因 Runtime 不可用而改变平台身份查询结果。

`auth whoami --agent` 使用同一所选凭据分别查询平台与 Runtime，并展示两个服务各自确认的用户和租户。Runtime 的只读本人身份入口 `GET /v1/dsh/whoami` 返回服务端认证得到的 `userId` 和 `tenantId`，不返回令牌或权限全集。CLI 比较两个实际响应，标明一致、不同或未验证。一致仅表示两个响应中的用户和租户一致，不单独证明两个服务属于同一部署。已有 `/v1/dsh/agent-catalog` 只返回租户及目录，不能证明 Runtime 报告的用户 ID。

应用 ID 在身份结果中仅表示选定上下文。应用准入和智能体可用性仍由现有 `agent directory`、逐次使用判断及实际操作确认。身份查询成功不表示管理、订阅或数据权限已获授予。

旧 Runtime 未提供本人身份入口时，`whoami --agent` 保留平台身份结果并明确报告 Runtime 身份未验证。网络失败、登录失效和权限拒绝保留各自原因。诊断不是每次业务操作的前置门槛；旧 Runtime 已支持的智能体命令仍可按原合同使用。Runtime 身份合同由 xrain-harness 持有。

## 智能体命令与会话

定义、工具、工作区、目录和对话使用所选 Runtime。订阅规则、本人订阅和应用选用使用平台。CLI 对适用命令传递显式或 profile 选定的应用上下文；Runtime 和平台分别按当前主体执行原有权限检查。

创建会话时保留实际 Runtime、应用上下文、sessionId 和 requestId 的可见结果。继续、等待和处理待答事项时使用同一 Runtime 与原应用上下文。更换 profile 后，不根据智能体名称、平台默认应用或同名会话猜测原目标；使用者可选回原 profile 或显式指定原入口和应用。现有会话历史由 Runtime 持有，CLI 不建立副本。

对话继续等待本轮完成，并区分接纳与完成。提交结果未知时回读原会话或等待原 requestId，不自动重发。待处理审批或问题仍由使用者明确决定；登录、创建定义或订阅不隐式发起对话。

`--wait-timeout` 是从本地输入校验结束、首次网络动作前开始的总预算，覆盖会话创建、流连接、输入 POST 及本轮跟随；每个 HTTP 请求另受 `--timeout` 约束。流与输入提交并行观察，只有关联到本请求、输入及本轮终态的事件才能先于迟到回执完成。预算到期或断流时，已尝试提交的输入保留结果未知及原标识；本地中止连接不调用服务端取消入口。

## 实施归属与验收

skills-hub 修改 CLI 源码、构建结果及完整 Skill 的连接和智能体使用知识。xrain-harness 按本人身份合同增加只读入口并维护对应契约。平台继续负责登录、本人资格与应用准入；本方案不要求平台新增 Runtime 登记或执行转发。正式产品和运行事实仍由各责任项目持有。

交付需验证：

1. 在独立安装的 Skill 中，从 profile 配置、正式登录和 `whoami --agent` 进入智能体目录；不用开发配置文件或另写脚本取得凭据。
2. 使用有管理权限的身份完成定义创建、配置、启用及回读。使用有订阅权限的实际身份申请并按现有策略取得结果。应用选用和个人订阅分别验证，不互相代替。
3. 在选定 Runtime 和身份下发起真实对话、继续同一会话并回读历史。确认返回的 sessionId、requestId 和完成结果；一次普通文本成功不代替工具或业务写入结果。
4. 覆盖重新登录保留同目标配置、profile 切换、单次覆盖、个人与应用上下文、旧 Runtime、身份不一致、未配置入口和服务不可用。保留原有平台命令及既有 `--runtime` 用法。
5. 使用临时或已授权环境和既有受管身份验证。保留既有账号、定义、订阅、会话和工作区；需要写入时按实际授权与环境合同操作。

对话、登录及身份入口的源码测试只能证明对应实现；真实登录与实际 Runtime 消费证据另行记录。构建、方案或本机隔离测试不证明其他部署已经更新。

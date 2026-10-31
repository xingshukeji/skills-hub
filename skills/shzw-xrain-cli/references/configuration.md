# 配置与认证

## 命令入口

执行 `node "<skill目录>/scripts/install-cli.mjs" --json`，使用返回的 `commandPath`。脚本在当前用户的 `.local/bin` 注册指向本技能 CLI 的入口，不使用 npm、不修改 PATH、profile 或会话。可用 `--bin-dir <目录>` 选择其他用户可写目录；目标已有非本技能命令时拒绝覆盖。技能脚本原地更新后无需重新注册；技能位置变化时再运行安装入口。不在 PATH 时使用 `commandPath`，或由使用者自行配置 PATH。安装不可用时继续使用 `node "<skill目录>/scripts/xrain-cli.mjs"`。

本技能交付的是 Node.js 22.12+ 独立脚本，不依赖 npm 或 .NET。项目中保留的旧 .NET XRain CLI 有其原有用途和操作入口，不随本技能更新或卸载，也不据此获得本文的新命令。执行本技能操作时使用上述 `commandPath` 或本目录脚本，先查当前入口的帮助，不以 PATH 中的同名命令代替。

## 连接与身份

目标优先级：命令参数 → XRAIN_SERVER/XRAIN_TENANT → profile → 内置默认地址。实际环境必须用登记地址；历史默认 127.0.0.1:5410 不代表当前部署。--server/--exchange 只接受 origin，不带路径、查询或用户密码；独立市场使用 --exchange，不能混平台 --server/--tenant/Token 参数。

profile list/show 查询已有连接。profile set（别名 login）保存连接，不做浏览器登录；只有 set/login/auth login 可创建 profile，其他命令对未知名称报错。平台 profile 忽略大小写，市场名称须保持原拼写。auth logout 保留 profile，顶层 logout 删除平台 profile 与会话。

智能体入口由实际服务方提供，不能根据平台地址或固定端口推断。将可访问的 Runtime origin 和可选应用 ID 保存到同一 profile；未配置应用时使用个人上下文。所选平台凭据会发送到该 Runtime，保存前确认入口属于预期服务。

```text
xrain-cli profile set --profile <连接> --server <平台地址> --tenant <租户ID> --runtime <智能体入口> [--application-id <应用ID>]
xrain-cli auth login --profile <连接>
xrain-cli auth whoami --profile <连接> --auth session --agent --json
```

同一平台、作用域和租户重新登录会保留智能体配置；改变任一项时，未重新指定的 Runtime 和应用关联会清除。命令可用 `--runtime`、`--application-id` 单次覆盖；`--personal` 单次选择个人上下文，`profile set --personal` 清除已保存的默认应用。单次切换平台、作用域或租户时，不复用原 profile 的 Runtime 和应用，需显式指定相应入口或选择另一个 profile。

普通 API 默认 --auth auto 顺序：
1. --bearer / XRAIN_TOKEN。
2. profile bearer。
3. --token-name / XRAIN_TOKEN_NAME / profile tokenName。
4. 目标、作用域和租户匹配且距过期至少一分钟的已保存会话。

应用包管理命令使用 --auth session，忽略前三项，不与显式 bearer/token-name 混用；缺有效会话直接失败。其他命令也可用 --auth session 明确选择保存的会话。API Token 仅用于目标开放的数据接口，不能代替真实用户管理会话。`--tenant` 不发送切租户 header，身份由服务端验证的 token 绑定。

通用 metadata/data/security 命令也可显式使用外部正常原生登录返回的短期 Bearer，优先通过本终端 `XRAIN_TOKEN` 提供；它是登录凭据，不是 API Token，不会自动保存为 CLI 会话。采用此路径时不指定 `--auth session`。Host 成员命令按 Host 登录合同验证资格，`--tenant-id` 只标识维护目标；应用包命令使用相应的已保存会话。

security tokens ensure 只准备本地 admin/guest 别名，不在服务端建身份或授予权限；服务端须预配同值。show 只读。不要把本地凭据存在当远端可用。

## 浏览器登录

auth login（兼容 app login）默认使用目标 cli-config、已登记 public client 及 OIDC code+PKCE。固定回调 http://127.0.0.1:38749/callback/，等待三分钟。浏览器 loopback 必须回到 CLI 主机；--no-browser 只关闭自动开页，不解决跨主机回调。保留命令直到回跳，端口冲突不杀未知进程。

XRain 平台认证中心支持设备授权时，可用 `auth login --device --server <平台> --tenant <租户> --profile <名称>`。在其他设备打开命令显示的网址，输入验证码并使用获准身份登录、确认；CLI 按服务器间隔等待并换取原租户会话。服务器未提供设备授权时明确报错，不能把 `--no-browser` 当成设备授权。独立市场暂不支持 `--device`。

平台与市场会话分开；独立市场使用浏览器会话。过期重新 auth login。只有 platform.authen.tenant_membership_required 才允许既有默认租户首次登录分支，最终仍须取得请求租户会话；其他拒绝不换租户或加权。

## 原生账号登录

平台原生账号可用 `auth login --native --user <账号> --password-stdin --profile <连接>`；先配置目标平台和租户，或在该命令显式指定 `--server`、`--tenant`。将密码原文从受控秘密来源以 UTF-8 通过管道传入标准输入；输入按原样读取，不自动删除尾部换行。不要在命令参数、终端历史、日志或版本库放密码。此模式不支持独立市场、设备授权或浏览器选项。成功后与浏览器登录一样保存受保护的租户会话，可用 `--auth session` 和 `auth whoami` 验证实际身份。

保留 TLS、state、签名、issuer/audience、nonce 等校验，不伪造会话。Windows 用内置 Windows PowerShell/当前用户 DPAPI，失败不降级明文；POSIX 会话目录 0700、文件 0600。

Host 使用 `auth login --scope host --native --user <已有Host账号> --password-stdin --profile <Host连接> --server <平台地址>`。平台必须返回明确的 Host 作用域与空租户，CLI 才保存会话；返回租户会话或失败时保留原登录。Host 会话与 tenant 会话分开绑定。Host OAuth 登录尚未接入，不能省略租户后把浏览器登录当成 Host 登录。Host 设置见[设置管理](settings.md)。

作用域默认为 tenant，缺租户不推断 Host。显式 `--scope host` 忽略继承的租户并拒绝同时传 `--tenant`。已保存 Host profile 遇到显式或环境租户覆盖时按 tenant 解析，原 Host 会话不复用；需要 Host 时显式给出作用域。独立市场不能使用平台 `--scope`。

## 本地状态与诊断

| 内容 | 默认 | 覆盖 |
| --- | --- | --- |
| 基础目录 | ~/.xrain | XRAIN_HOME |
| Profile | ~/.xrain/profiles.json | XRAIN_CONFIG_PATH |
| 本地测试令牌 | ~/.xrain/local-test-secrets.json | XRAIN_LOCAL_TEST_SECRETS_PATH，其次 XRain__Security__SeedApiTokens__Path |
| 会话 | ~/.xrain/sessions/ | XRAIN_SESSION_DIR |

显式路径优先；文件不放 Git。profile bearer/旧测试令牌仍是明文，DPAPI 保护保存的会话，诊断不展示文件内容。

auth status --json 只查本地，remoteValidation=not_checked；valid 不证明远端接受。auth whoami --json 使用本次选中的平台地址和凭据调用 XRain 当前身份接口，返回 profile、server、configuredTenant、credentialSource，以及服务器认出的 userId、tenantId、scope；不返回令牌或权限全集。configuredTenant 是本地目标，tenantId 是服务器实际身份，两者可能不同；Host scope 的实际 tenantId 为 null。查询前优先显式提供预期 --server 及命令支持的 --tenant；若依赖默认值，先用本地 auth status --json 核对解析的服务地址，避免向错误地址发送凭据。后续业务使用相同的目标和认证方式；应用包操作应给身份查询指定 --auth session。它只用于 XRain 平台，不适用于独立市场。身份查询及后续命令是两次执行，并发替换同名会话后不能当作强绑定。

`auth whoami --agent` 使用同一凭据再查询所选 Runtime 的本人身份，比较两个服务返回的 userId 和 tenantId。`identity_confirmed` 只表示两次身份响应一致，不证明部署归属、应用准入或业务权限。旧 Runtime 不支持身份接口、连接失败或身份不一致时，命令报告错误并保留已确认的平台身份；普通 `auth whoami` 不依赖 Runtime。`agentContext.applicationId` 仅表示选定的应用，实际资格还需按具体操作查询。

doctor --json 的平台 /health/ready 可能无需认证，成功只说明该接口可访问，remoteValidation 仍为 not_checked；市场 /api/exchange/v1/my-published 的成功只证明该接口接受对应市场会话。两者都不证明完整业务权限。无需每次操作前运行整套诊断。

401 查来源/过期及认证方式；authentication_method_not_allowed 不能靠加角色解决。403 查原用户成员和授权；TLS/网络查目标与信任，不关闭校验。HTTP 默认 100 秒，--timeout 为正整数秒，上限一天；原生账号登录也使用此值。浏览器与设备登录的单次 HTTP 请求最多 30 秒，设备轮询还受授权剩余时间约束；浏览器回调另有三分钟等待时间。缺身份或原应用登录失败读[账号与登录](login.md)。

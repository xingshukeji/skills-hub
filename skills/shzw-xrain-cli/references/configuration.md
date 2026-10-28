# 配置与认证

## 连接与身份

目标优先级：命令参数 → XRAIN_SERVER/XRAIN_TENANT → profile → 内置默认地址。实际环境必须用登记地址；历史默认 127.0.0.1:5410 不代表当前部署。--server/--exchange 只接受 origin，不带路径、查询或用户密码；独立市场使用 --exchange，不能混平台 --server/--tenant/Token 参数。

profile list/show 查询已有连接。profile set（别名 login）保存连接，不做浏览器登录；只有 set/login/auth login 可创建 profile，其他命令对未知名称报错。平台 profile 忽略大小写，市场名称须保持原拼写。auth logout 保留 profile，顶层 logout 删除平台 profile 与会话。

普通 API 默认 --auth auto 顺序：
1. --bearer / XRAIN_TOKEN。
2. profile bearer。
3. --token-name / XRAIN_TOKEN_NAME / profile tokenName。
4. 目标、租户匹配且距过期至少一分钟的浏览器会话。

应用包管理命令使用 --auth session，忽略前三项，不与显式 bearer/token-name 混用；缺有效会话直接失败。其他命令也可用 --auth session 明确选择浏览器会话。API Token 仅用于目标开放的数据接口，不能代替真实用户管理会话。`--tenant` 不发送切租户 header，身份由服务端验证的 token 绑定。

通用 metadata/data/security 命令也可显式使用正常原生登录返回的短期 Bearer，优先通过本终端 `XRAIN_TOKEN` 提供；它是登录凭据，不是 API Token，不写入浏览器会话文件。采用此路径时不指定 `--auth session`。Host 成员命令按 Host 登录合同验证资格，`--tenant-id` 只标识维护目标；应用包命令继续使用正式浏览器会话。

security tokens ensure 只准备本地 admin/guest 别名，不在服务端建身份或授予权限；服务端须预配同值。show 只读。不要把本地凭据存在当远端可用。

## 浏览器登录

auth login（兼容 app login）使用目标 cli-config、已登记 public client 及 OIDC code+PKCE。固定回调 http://127.0.0.1:38749/callback/，等待三分钟。浏览器 loopback 必须回到 CLI 主机；远端执行用已有获准同机浏览器/转发。--no-browser 只关闭自动开页，不解决跨主机回调。保留命令直到回跳，端口冲突不杀未知进程。

平台与市场会话分开；app check/build/publish/status 只用浏览器会话。过期重新 auth login。只有 platform.authen.tenant_membership_required 才允许既有默认租户首次登录分支，最终仍须取得请求租户会话；其他拒绝不换租户或加权。

保留 TLS、state、签名、issuer/audience、nonce 等校验，不伪造会话。Windows 用内置 Windows PowerShell/当前用户 DPAPI，失败不降级明文；POSIX 会话目录 0700、文件 0600。

## 本地状态与诊断

| 内容 | 默认 | 覆盖 |
| --- | --- | --- |
| 基础目录 | ~/.xrain | XRAIN_HOME |
| Profile | ~/.xrain/profiles.json | XRAIN_CONFIG_PATH |
| 本地测试令牌 | ~/.xrain/local-test-secrets.json | XRAIN_LOCAL_TEST_SECRETS_PATH，其次 XRain__Security__SeedApiTokens__Path |
| 会话 | ~/.xrain/sessions/ | XRAIN_SESSION_DIR |

显式路径优先；文件不放 Git。profile bearer/旧测试令牌仍是明文，DPAPI 只保护浏览器会话，诊断不展示文件内容。

auth status --json 只查本地，remoteValidation=not_checked；valid 不证明远端接受。auth whoami --json 使用本次选中的平台地址和凭据调用 XRain 当前身份接口，返回 profile、server、configuredTenant、credentialSource，以及服务器认出的 userId、tenantId、scope；不返回令牌或权限全集。configuredTenant 是本地目标，tenantId 是服务器实际身份，两者可能不同；Host scope 的实际 tenantId 为 null。查询前优先显式提供预期 --server 及命令支持的 --tenant；若依赖默认值，先用本地 auth status --json 核对解析的服务地址，避免向错误地址发送凭据。后续业务使用相同的目标和认证方式；应用包操作应给身份查询指定 --auth session。它只用于 XRain 平台，不适用于独立市场。身份查询及后续命令是两次执行，并发替换同名会话后不能当作强绑定。

doctor --json 的平台 /health/ready 可能无需认证，成功只说明该接口可访问，remoteValidation 仍为 not_checked；市场 /api/exchange/v1/my-published 的成功只证明该接口接受对应市场会话。两者都不证明完整业务权限。无需每次操作前运行整套诊断。

401 查来源/过期及认证方式；authentication_method_not_allowed 不能靠加角色解决。403 查原用户成员和授权；TLS/网络查目标与信任，不关闭校验。HTTP 默认 100 秒，--timeout 为正整数秒，上限一天；登录各请求固定 30 秒。缺身份或原应用登录失败读[账号与登录](login.md)。

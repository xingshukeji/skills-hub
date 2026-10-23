# 配置与认证

## 连接与身份

目标优先级：命令参数 → XRAIN_SERVER/XRAIN_TENANT → profile → 内置默认地址。实际环境必须用登记地址；历史默认 127.0.0.1:5410 不代表当前部署。--server/--exchange 只接受 origin，不带路径、查询或用户密码；独立市场使用 --exchange，不能混平台 --server/--tenant/Token 参数。

profile list/show 查询已有连接。profile set（别名 login）保存连接，不做浏览器登录；只有 set/login/auth login 可创建 profile，其他命令对未知名称报错。平台 profile 忽略大小写，市场名称须保持原拼写。auth logout 保留 profile，顶层 logout 删除平台 profile 与会话。

普通 API 默认 --auth auto 顺序：
1. --bearer / XRAIN_TOKEN。
2. profile bearer。
3. --token-name / XRAIN_TOKEN_NAME / profile tokenName。
4. 目标、租户匹配且距过期至少一分钟的浏览器会话。

管理接口使用 --auth session，忽略前三项，不与显式 bearer/token-name 混用；缺有效会话直接失败。API Token 仅用于目标开放的数据接口，不能代替管理会话。`--tenant` 不发送切租户 header，身份由服务端验证的 token 绑定。

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

auth status --json 只查本地，remoteValidation=not_checked；valid 不证明远端接受。doctor --json 用实际凭据探测平台 /health/ready 或市场 /api/exchange/v1/my-published，只证明该接口结果，不证明完整业务权限。无需每次操作前运行两者。

401 查来源/过期及认证方式；authentication_method_not_allowed 不能靠加角色解决。403 查原用户成员和授权；TLS/网络查目标与信任，不关闭校验。HTTP 默认 100 秒，--timeout 为正整数秒，上限一天；登录各请求固定 30 秒。缺身份或原应用登录失败读[账号与登录](login.md)。

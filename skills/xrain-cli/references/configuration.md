# 配置与认证

## 运行要求

只需 Node.js 22.12+，推荐 Node.js 24 LTS。`scripts/xrain-cli.mjs` 是已打包的可运行制品；无需 npm 依赖安装，也无需 .NET SDK。Windows 使用系统自带的 Windows PowerShell 调用当前用户的 DPAPI 保护浏览器会话；失败时不会降级为明文。macOS/Linux 的会话目录权限为 `0700`、文件为 `0600`。

`auth login`（兼容别名 `app login`）需要目标 API 提供 CLI 配置、可访问的 OIDC 服务及已登记的 public client。固定回调为 `http://127.0.0.1:38749/callback/`，等待时间三分钟；回调端口占用时退出并提示。无需把该端口暴露到外网。

## 存储位置

| 内容 | 默认路径 | 覆盖变量 |
| --- | --- | --- |
| 基础目录 | `~/.xrain` | `XRAIN_HOME` |
| Profile | `~/.xrain/profiles.json` | `XRAIN_CONFIG_PATH` |
| 本地测试令牌 | `~/.xrain/local-test-secrets.json` | `XRAIN_LOCAL_TEST_SECRETS_PATH`，其次 `XRain__Security__SeedApiTokens__Path` |
| 浏览器会话 | `~/.xrain/sessions/` | `XRAIN_SESSION_DIR` |

显式文件路径优先于 `XRAIN_HOME`。这些文件不属于 skill，不应放进项目或提交到 Git。独立测试时设置 `XRAIN_HOME` 到临时目录，并清除上表的单独路径覆盖和已有凭据环境变量。

兼容原 CLI 的 profile、local-test-secrets 和 session 格式。平台 profile 名忽略大小写；独立市场沿用原 CLI 的区分大小写 profile 标识，同一次操作流程保持 `--profile` 拼写一致。`--server` / `--exchange` 要求纯 origin（协议、主机、端口），不接受路径、查询参数、URL 中的账号密码。开发默认地址是 `http://127.0.0.1:5410`。

原版存于 profile 的 bearer 和本地测试令牌是明文凭据；Node 版本保持格式兼容，在 POSIX 系统限制文件权限。推荐使用已有令牌别名、环境变量或浏览器会话。Windows 的 DPAPI 仅保护浏览器会话文件。

## 普通 API 凭据优先级

1. `--bearer`，其次 `XRAIN_TOKEN`。
2. Profile 保存的 bearer。
3. `--token-name`，其次 `XRAIN_TOKEN_NAME`，其次 profile 的 tokenName，支持 `admin`、`guest`。
4. 与 profile、服务器、租户相匹配且距过期至少一分钟的浏览器会话。

以上为默认 `--auth auto` 的行为。`--auth session` 会忽略环境变量、profile bearer 和 token alias，明确选择浏览器会话；没有匹配的有效会话就报错，不匿名调用、不改用其他身份。不能把它与显式 `--bearer` / `--token-name` 混用。浏览器登录成功后，如果自动模式仍选中了旧的 `XRAIN_TOKEN`，用 `auth status` 确认来源，再选择 `--auth session`。

如果没有凭据，普通请求不带 Authorization，由目标 API 决定是否允许匿名。普通 HTTP 命令仍要求配置 `tenant`，但它不作为 header 发送。

凭据优先级只决定客户端发送什么，不改变接口接受的认证方式。当前开发服务仅在开放的数据接口接受 API Token；权限管理、元数据及健康检查会拒绝 API Token，即使该 token 属于管理员。连接验证优先使用 `auth login`，再用 `doctor --auth session` 探测连接。API Token 使用单独 profile 或对应数据命令的 `--token-name`；认证方式被拒绝不代表 token 已过期。

请求目标依次采用命令参数、`XRAIN_SERVER` / `XRAIN_TENANT`、profile、默认服务器。`profile set` 和 `login` 持久化命令参数及已有 profile 值；环境中的服务器与租户只覆盖本次请求。指定 `--token-name` 保存 profile 时会清除旧的已保存 bearer。

`security tokens ensure` 保留已有令牌，补齐缺失值；`XRain__Security__SeedApiTokens__Admin` / `Guest` 可显式替换对应值。`show` 只读并列出配置的别名。第一次使用有效别名也会补齐本地令牌存储，保持旧 CLI 行为；服务器必须预先配置同一值才能识别该身份。

## 浏览器应用会话

`auth login` 获取 CLI 配置，执行 authorization code + PKCE S256，验证一次性 state、RS256 签名、issuer、audience、过期时间、iat、sub、nonce 和可选 azp/at_hash，再向目标服务器换取会话。找不到签名 key 时只刷新一次 discovery/JWKS。不会通过关闭 TLS 校验解决证书问题。

请求目标租户时，只有服务器明确返回 `platform.authen.tenant_membership_required` 才尝试原有的默认租户首次登录流程；不会因其他 403 自动换租户。最终会话必须属于请求的租户。

`app check`、`build`、`publish`、`status` 只使用浏览器会话，即使存在管理员 API token 也不会替代。平台与独立市场的会话分开存储。没有 refresh token 自动续期；过期后重新运行 `auth login`。

`batch` 在同一进程内按加密文件摘要复用解密结果，每次取用仍核对服务器、租户与过期时间。文件改变或删除、`auth logout`、会话过期都会使旧会话不可用。缓存不写明文文件，退出进程即结束。

## 状态与连接诊断

`profile list` 列出已有平台连接；`profile show` 显示当前实际解析的目标与凭据来源。使用连接的命令显式指定未知 profile 时会报 `profile_not_found`；只有 `profile set` / `login`、`auth login` / `app login` 可以创建新连接。

`auth status --json` 只检查本地状态，不发 HTTP 请求，不生成测试 token。它显示 `credentialSource`、`credentialConfigured`、`remoteValidation: "not_checked"`、会话过期时间和以下状态：`valid`、`missing`、`expired`、`expiring`（一分钟内过期）、`server_mismatch`、`tenant_mismatch`、`unreadable` 或 `protection_unavailable`。本地显示有效，不代表服务端仍接受它。

`doctor --json` 用实际选中的凭据发起只读探测：平台使用 `GET /health/ready`，独立市场使用 `GET /api/exchange/v1/my-published`。成功只证明该探测接口接受了请求，不证明所有管理或数据操作都有权限。网络失败、服务端拒绝和没有可用凭据均非零退出，并附带认证来源和已知诊断信息；不会自动换身份重试。

独立市场使用 `--exchange`，不能同时指定 `--server`、平台 `--tenant` 或 API Token 参数。

## 常见问题

| 表现 | 处理 |
| --- | --- |
| Node 版本过低 | 安装 Node.js 22.12+，然后重跑同一个脚本 |
| profile 不存在 | 用 `profile list` 检查名称，或用 `auth login` / `profile set` 创建 |
| 缺少 tenant | 在已有授权范围内设置 `--tenant` 或 profile |
| 401 / `authentication_failed` | 用 `auth status` 核对凭据来源，必要时重新浏览器登录 |
| `authentication_method_not_allowed` | 该接口不接受此类凭据；管理接口明确选择浏览器会话 |
| 403 | 核对服务端账号、租户成员资格和权限，不自动提权 |
| 回调端口被占用 | 结束该用户自己未完成的登录，或等待其结束再重试 |
| TLS / 网络失败 | 检查目标、网络、可信证书；CLI 不跟随 HTTP 重定向 |
| 输出已存在 | 选择新文件名，不覆盖源文件或已有包 |
| 发布响应异常 | 先用同一目标和 profile 运行 `app status`，核对版本再重试 |
| `invalid_arguments` | 按该子命令的 `--help` 修正参数；请求尚未发出 |

HTTP 默认超时 100 秒，可用 `--timeout <正整数秒>` 修改，上限一天；登录配置、OIDC 和 SSO 的单次请求固定 30 秒。

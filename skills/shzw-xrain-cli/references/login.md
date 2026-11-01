# 平台账号与登录

先区分认证中心身份、平台用户与租户成员。纳管系统读生效固定账号规则，复用原人物；缺密码走原身份获准恢复，不按任务另建身份。

## 平台用户

使用平台原生租户账号时，先配置目标连接，再将已登记的密码以 UTF-8 原文通过受控标准输入传给 `auth login --native --user <账号> --password-stdin --profile <连接>`；密码不写在命令参数中。输入不会自动去掉末尾换行。登录后用 `auth whoami --profile <连接> --auth session --json` 核对原用户和租户。统一登录账号仍使用浏览器或设备登录。

Host 管理员复用已有全局身份，通过单独的 Host profile 执行 `auth login --scope host --native --user <原账号> --password-stdin`；不指定租户，也不因租户管理员权限推断 Host 权限。成功后用 `whoami` 核对 `scope: host` 和 `tenantId: null`，再使用[Host 设置](settings.md)。原生 Host 登录不会创建身份、变更口令或增加权限。

用原获准管理员会话查询：

```text
security user ensure --user <固定登录名> --profile <目标> --auth session --json
```

已存在返回 {created:false,user}，保留密码、名称和权限。仅 404 / platform.authen.user_not_found 可进入创建；其他错误不是不存在。确实缺失且创建已授权时，从秘密文件或 stdin 提供 {name,password,...}：

```text
security user ensure --user <固定登录名> --values-json - --profile <目标> --auth session --json
```

新合成身份用系统随机密码并存指定秘密库；不要内联密码。创建不自动授角色；全局同名身份已存在时，由获准 Host 管理入口将原 userId 加入目标租户，不改名再建。提交未知先 security user show 查询。

## 切换本人的企业

先用 `auth tenants --auth session` 查询本人可访问企业，再执行：

```text
auth switch-tenant <目标租户ID> --profile <原连接> --auth session --json
auth switch-tenant <目标租户ID> --profile <原连接> --save-profile <另一个连接> --auth session --json
```

命令使用原连接的已保存租户会话，先读取实际主体，再通过平台原切换接口取得同一人在目标租户的会话。省略 save-profile 时替换当前连接；指定另一个连接时保留原连接和登录。成功后选中目标连接，只保留已绑定同一平台和目标租户的 Runtime、应用配置。Host 登录及服务 Token 不能代替租户登录。

目标成员失效、平台拒绝或回执无法确认时，CLI 保留原连接，不自动重试。切换后用 `auth whoami --auth session` 核对新企业，再执行其业务操作；切换不会授予成员资格或应用准入。

## 签发本人 API Token

`auth api-token create --request-json <签发.json> --out <新凭据文件.json>` 使用本人已保存的租户或 Host 登录。签发文件只接收 `endTimeUtc`，例如 `{"endTimeUtc":null}`，有效期由平台决定。命令不接受目标用户，不替换登录，Token 保存为绑定服务器、租户和作用域的受保护文件。后续通过 `--token-file` 消费，不能把凭据文件当作登录会话。

输出文件须不存在。签发回执丢失时，原接口没有客户端请求键可回查；先由同作用域的获权维护者核对原服务 Token 清单，不自动再次签发。管理员为指定成员签发、查询和撤销的入口仍为 `security api-token`。

## 租户管理员代理执行

租户管理员可以用现有平台登录代理同租户的有效成员，不需要目标用户密码：

```text
auth login-as --profile <管理员连接> --user <固定登录名> --save-profile <成员连接> --auth session --json
auth whoami --profile <成员连接> --auth session --json
```

`--profile` 选择已有租户管理员会话，`--save-profile` 是另一个成员连接。命令调用平台原生 `account/login-as`，返回实际 `userId`、`tenantId` 和 `proxyByUserId`，并按现有会话保护方式保存成员会话。原管理员会话和活动连接保持。目标连接已配置同一平台和租户时保留其Runtime及应用；新连接继承管理员连接的对应配置。

后续消息、群管理及其他业务命令使用该成员连接和 `--auth session`，按成员自己的权限执行；目标成员不因此获得管理员角色。普通用户、Host作用域、其他租户及停用或不存在的成员由原平台拒绝。失败保留原连接和会话。代理能力不构成任意发送或批量外部操作的授权，实际动作仍须来自当前用户任务。

## 原应用登录

中心身份不能用 security user ensure 创建。需要统一认证时使用可用的 shzw-xrain-access 或中心原网页：/admin/local-accounts 与 /admin/users 查重；已有主体“设置本地登录”，确实缺失才创建普通账号并在 /login/activate 激活，保留 MFA。原码失效后的“恢复密码与验证器”会撤销登录、清除验证器，须已有恢复授权。中心管理员网页不依赖 CLI 客户端。

CLI client_id 被拒：读 /api/application/v1/cli-config，按准确 client、回调、scope 核对中心登记；不重置用户密码。auth login 成功后管理命令用 --auth session 排除旧 Token。

最终回原应用核对实际用户、租户和业务动作；登录后 403 查成员/准入及业务权限，不换管理员。验证密码必须正常退出原应用与中心、看到密码表单再输入。凭据、激活码、授权码 URL 不进入报告或截图。

# 平台账号与登录

先区分认证中心身份、平台用户与租户成员。纳管系统读生效固定账号规则，复用原人物；缺密码走原身份获准恢复，不按任务另建身份。

## 平台用户

用原获准管理员浏览器会话查询：

```text
security user ensure --user <固定登录名> --profile <目标> --auth session --json
```

已存在返回 {created:false,user}，保留密码、名称和权限。仅 404 / platform.authen.user_not_found 可进入创建；其他错误不是不存在。确实缺失且创建已授权时，从秘密文件或 stdin 提供 {name,password,...}：

```text
security user ensure --user <固定登录名> --values-json - --profile <目标> --auth session --json
```

新合成身份用系统随机密码并存指定秘密库；不要内联密码。创建不自动授角色；全局同名身份已存在时，由获准 Host 管理入口将原 userId 加入目标租户，不改名再建。提交未知先 security user show 查询。

## 原应用登录

中心身份不能用 security user ensure 创建。需要统一认证时使用可用的 xrain-auth 或中心原网页：/admin/local-accounts 与 /admin/users 查重；已有主体“设置本地登录”，确实缺失才创建普通账号并在 /login/activate 激活，保留 MFA。原码失效后的“恢复密码与验证器”会撤销登录、清除验证器，须已有恢复授权。中心管理员网页不依赖 CLI 客户端。

CLI client_id 被拒：读 /api/application/v1/cli-config，按准确 client、回调、scope 核对中心登记；不重置用户密码。auth login 成功后管理命令用 --auth session 排除旧 Token。

最终回原应用核对实际用户、租户和业务动作；登录后 403 查成员/准入及业务权限，不换管理员。验证密码必须正常退出原应用与中心、看到密码表单再输入。凭据、激活码、授权码 URL 不进入报告或截图。

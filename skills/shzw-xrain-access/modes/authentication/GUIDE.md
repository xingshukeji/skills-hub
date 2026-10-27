# XRain 统一登录

本模式运行前提：Authorized browser access to the authentication center and original application.

沿原应用实际入口和配置，用获准浏览器完成正常登录；已有身份和凭据可直接登录，无需先取管理员会话。

- 缺身份、激活、锁定或凭据：[账号准备](references/accounts.md)。
- client、回调或 scope 被拒：[接入修复](references/clients.md)。
- 中心成功，原应用拒绝：[平台准入](references/platform-access.md)。

中心身份、平台用户、租户成员分开判断；同名不证明关联。`security user ensure` 不能建中心身份，CLI 故障不阻断中心网页。

保留 MFA、反伪造与授权流程，秘密留在指定存储。验证密码时正常退出应用和中心、看到密码表单再登录；最终核对原应用用户、租户及业务动作。

参考相对本模式目录（Workforce 的 `resourceBase.path + "/modes/authentication"`）。

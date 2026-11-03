# XRain 统一登录

本模式运行前提：Authorized browser access to the authentication center and original application.

沿原应用实际入口和配置，用获准浏览器完成正常登录；已有身份和凭据可直接登录，无需先取管理员会话。

- 缺身份、激活、锁定或凭据：[账号准备](references/accounts.md)。
- client、回调或 scope 被拒：[接入修复](references/clients.md)。
- 中心成功，原应用拒绝：[平台准入](references/platform-access.md)。

中心身份、平台用户、租户成员分开判断；同名不证明关联。`security user ensure` 不能建中心身份，CLI 故障不阻断中心网页。

校准登录、上游错误、反复失效或跨租户判断时，按[身份与准入判例](references/calibration-cases.md)选择原场景及相邻反例；角色开通、成员关系和系统依赖分别核对，不用改成管理员或重建身份掩盖失败。

保留 MFA、反伪造与授权流程，秘密留在指定存储。验证密码时正常退出应用和中心、看到密码表单再登录；最终核对原应用用户、租户及业务动作。

参考相对本模式目录（Workforce 的 `resourceBase.path + "/modes/authentication"`）。

# XRain 业务权限

用原用户、租户和具体动作复现；403 可能是正确拒绝，不能默认加权。

- 不知道拒绝在哪层：[定位](references/access.md)。
- 新用户、角色调整或撤权：[授权来源与变更](references/authorization.md)。
- 自动化、机器人、代发失败：[执行权限](references/execution.md)。

只修本次获准且符合原职责的缺口，保留其他授权；集合替换前先读取，并发冲突后重新合并。以原用户复测相关允许及禁止动作，不能换管理员证明修复。固定身份先按目标账号规则复用。

通过目标管理页面、受管 API 或已可用 CLI 操作。参考相对本模式目录（Workforce 的 `resourceBase.path + "/modes/authorization"`）；报告拒绝层、授权差异和复测结果。

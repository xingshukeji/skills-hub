# 平台操作与责任

本页给出已确认的能力定位，供主线选择入口。具体请求体、版本和目标 ID 使用目标交付合同或当前管理页面；接口不存在时报告差异，不猜另一条路由。需要 CLI 时先发现宿主已有 CLI 与帮助，本 skill 不要求安装相邻目录。

## 从业务问题找到实际所有者

| 业务问题 | 实际入口或来源 | 需要核对的结果 |
| --- | --- | --- |
| 原人能否登录 | 目标认证中心网页及原应用回调 | 原 userId 与认证主体关联；旧登录会话不能证明密码有效 |
| 原人在哪个租户工作 | 平台受管全局用户/租户成员入口 | 同一全局身份、目标成员状态；组织关系不代替成员资格 |
| 业务请求使用谁 | `GET /api/service/authen/v1/account/context` | tenantId、userId、effectivePermissions、scope；不在正文里打印令牌 |
| 业务页面选人 | `GET /api/tenant/v1/members` 及成员详情 | 受控成员资料；可见不等于有业务权限 |
| 是否能进入应用 | 原用户 `POST /api/xrain/v1/applications/{applicationId}/admission` | allowed/reason；再检查实际业务动作 |
| 谁被发布允许 | 管理入口的 application `publication-scope` | 读取 mode/userIds/departments/revision；获准修改时保留原集合并带 expectedRevision |
| 专门职责与有效授权 | application 的 roles、permission-sets、grant-directory、grant-ceiling、resources | active 角色、未 muted 权限集、真实 permissionId/scopeJson 和来源 |
| 全员基础 | `xrain-all-employees` 及已启用的应用全员权限集 | 有效租户成员及同 ID active User；不逐人复制全员角色 |
| 业务数据范围 | 元数据 describe、对象/字段权限、共享规则和原人记录请求 | 对象、字段及记录都获准；管理元数据拒绝可能正确 |
| 私有续办和工具执行 | Workforce/Runtime 的本人会话、对象引用及获权工具 | 原人、原租户、原记录与原会话；应用准入不代替执行授权 |
| 能办业务但不能选择 AI | Runtime 目录与 `/api/xrain/v1/agents/qualifications?applicationId=...` | 核对原用户应用准入、应用选用、定义启用及实际运行版本；应用不增加个人订阅或客户端映射门槛，个人入口仍检查本人订阅 |

平台全员基础不自动覆盖 Host、匿名、跨租户、停用成员或 applicationId 非空的应用机器人。它提供已声明的通用入口，业务对象与字段权限仍需成立。机器人、后台处理者和业务人员分开核对执行资格，不借用个人全权凭据。

## 修改授权时保留既有结果

应用管理基址为 `/api/xrain/v1/applications/{applicationId}`。`roles/{roleId}/users`、`roles/{roleId}/permission-sets`、`permission-sets/{id}/items` 的 PUT 替换集合。先读取、只改获准项，再提交完整目标集合；创建权限集不等于把它分给使用者。

删除或收缩前，按目标表单合同调用 `POST authorization-impact`。读取 digest、sources、affectedSourceCount、canRetain。提交若要求 impactDigest/decisions，使用本次摘要及已决定的实际 sourceId。canRetain 是可选能力，不能当作已授权保留。并发变化或摘要失效时重新读取并核对影响。

撤掉直接授权后，其他角色、全员集或共享来源可能仍然有效。按实际职责判断这些来源应否保留；不得为了制造拒绝而删除无关来源。发布准入、业务权限和执行资格分别复测。

## 完成业务和共享

对象及字段描述由 `/api/metadata/v1/entities/{entityCode}/describe` 提供。记录 HTTP 入口为 `/api/data/v1/entities/{entityCode}/records`；查询使用 `:query`。这些与 SDK、编排 callable 的输入合同不同，不互相拼接。

单条分享从记录的 `/shares/capability`、`/shares/recipients` 和 `/shares/eligibility?userId=...` 开始。按真实 supportsManualSharing、canManageManualShares、canGrantUpdate 等能力选择动作。分享仅授予已支持的记录范围，不增加接收人的对象/字段权限。

Owner 转移使用受管 `:transferOwner` 和 `{ownerId}`，不是普通字段更新。目标应为本租户 active 成员并具有对象 Read；操作方还须满足该入口及记录的管理条件。Owner 转移不自动交接任务责任、个人对话或邮箱。

共享规则的 roleIds 与主体条件按 OR 合并；“本部门且具有该职责”必须在主体 all 条件中同时表达，不能把角色放进另一条 OR 来源。只在业务确有此范围时配置，已有规则先读取并保留。

## 故障后从原环节继续

| 观察 | 下一步 |
| --- | --- |
| 中心登录成功，原应用仍无成员 | 核对原 userId 与目标租户关联，不重建身份 |
| 应用被拒绝，业务职责已存在 | 读取 admission.reason 和发布范围，不先加对象权限 |
| 进入应用但保存被拒绝 | 对照实际请求的动作、对象、字段和记录来源 |
| 404、空目录或空列表 | 区分目标缺失、不支持、过滤和无数据；不要直接当作 403 扩权 |
| 管理员成功、普通人失败 | 保留普通人失败，沿原身份定位；管理员不能替代验收 |
| 保存/授权请求超时 | 读回原资源和操作结果，再决定是否重试 |
| 撤权后页面仍显示旧值 | 用原身份发起新读取或写入，区别浏览器缓存与服务端仍允许 |
| 应用准入通过，智能体目录仍拒绝 | 记录外层状态及实际上游错误；核对调用客户端与应用对应关系，再查资格，不直接扩大业务角色 |
| 工具成功但业务未办成 | 查来源结果、业务错误和持久记录，不用模型总结认定成功 |

固定账号与目标配置由目标责任项目维护。本目录不保存凭据、用户列表或当前实例地址；未核实的产品版本与管理能力保留未知。

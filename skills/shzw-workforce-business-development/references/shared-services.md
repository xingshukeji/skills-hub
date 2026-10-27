# 公共服务与应用交付

产品事实：Workforce；涉及 Runtime、统一认证或平台 API 时沿该能力实际所有者核对。
维护与适用：本专题由 skills-hub 维护，面向公开能力的业务使用；接口、示例与历史实测的原有适用条件继续有效。内部修改由目标项目入口定位源码与测试。

## 消息、通知与人员协作

Workforce 消息、协作 Task 和外部投递各自接入，记录更新或智能体运行结束不会自动产生它们。

| 目的 | 接入方式与需要明确的内容 |
| --- | --- |
| 在当前业务会话中呈现消息 | 使用 Workforce 已有消息服务和会话上下文，保存实际消息结果 |
| 交给人员或 AI 员工继续处理 | 使用目标版本的 Task 能力，明确责任人、业务目标与当前状态 |
| 向外发送模板通知 | 已配置的通道、账户与模板，以及实际发送身份和权限 |
| 查询投递结果或处理重试 | 使用投递记录、业务幂等键及对应通道提供的状态 |

以下 callable 的实测 `signature` 均为 null，参数来自 `helpText`；尚未实测投递：

| callable | 目录描述的输入 |
| --- | --- |
| `delivery.sms.send` | `{phoneNumber, templateKey, templateParams, originalText, idempotencyKey}`；未启用可返回 ignored，不产生发送事实 |
| `delivery.email.sendByTemplate` | `{templateName, recipient?, preference?, data, whatId?, idempotencyKey?, triggerPermission?}`；recipient 可为 `{kind: "User", userId}`，triggerPermission 仅用于 Trigger |
| `delivery.email.findByIdempotencyKey` | `{templateName, whatId, idempotencyKey, triggerPermission?}`；需发送权限及关联记录读取权，未找到可返回 null |
| `delivery.feishu.sendByTemplate` | `{templateName, recipient, data, whatId?, idempotencyKey}`；recipient 为 `{kind: "User", userId}` 或 `{kind: "Chat", chatId}` |

分别配置通道、账户、模板、启用状态和权限；修改模板与发送是独立操作，接收人按通道合同填写。

用 `XRainRuntimeClient.applicationMessageAuthorization(applicationId)` 读取消息资格；机器人显示名不改变实际执行主体。外部投递“已受理”不等于送达，包括 SMTP accepted。

实测同一普通成员 admission 为 allowed，message-authorization 却返回 403、`application_management_forbidden`。此次未发送消息，应用准入不包含发送权。

响应丢失时发送可能已成功；按业务事件使用稳定幂等标识并查询结果，重试不换标识。仅报告通道已确认的状态。

Task 表示责任和进度，Session/Run 表示执行过程，订单/工单表示业务事实；通过目标标识关联，各自判断完成。草稿、确认和验收按目标 Task 合同接入。已有审批流程由原系统执行，Workforce 发起、跟踪或组织协作。

个人来信与回复草稿使用[个人邮箱](personal-email.md)的真实用户链路；应用助手选择、订阅和启动资格见[智能体接入](agent-access.md)。

## 文件与附件

平台文件服务保存内容和稳定 `fileId`；Workforce/企业应用维护文件与会话、消息、记录的关系及访问资格。保存关系时复用上传返回的 `fileId`。

`/api/service/files/v1/files` 使用允许的服务主体 API Token，并检查 `platform.files.invoke` 等条件。页面使用已交付的 Workforce/应用附件入口，由宿主传递可信上传者与业务上下文。

已核对的 `@xrain/workforce-application/server` 0.3.5 导出 `XRainRuntimeClient`，未导出 `XRainFileClient`。复用宿主文件 API 或目标版本的公开客户端，不导入包内部路径。

上传后保存附件引用；下载/预览按当前用户与关联资源授权，稳定 URL 仍可能需要认证。`uploaderId` 来自会话，不接受页面自填。

消息重试复用已上传文件，删除沿引用与保留规则处理。内容提取、预览和知识库索引需分别接入。

## 应用与资源的生效

XRain 应用按租户和应用身份管理，各交付层分别确认：

| 内容 | 实际改变什么 | 如何确认本次结果 |
| --- | --- | --- |
| 模型和集成资源源码 | 可交付的对象、字段、权限、连接器/请求/接口、函数等受支持资源 | 源码结构及引用有效，按目标规范生成 |
| `.appkg` 构建 | 形成服务端构建的可安装制品 | 构建结果与包完整性通过；尚不表示已安装 |
| 包导入与安装 | 在目标环境维护相应平台资源 | 目标元数据或资源目录出现预期定义 |
| 应用资源关联和版本选择 | 该应用采用哪些对象、接口或函数版本 | 应用资源与修订显示预期选择 |
| 应用启用、准入与权限 | 哪些成员可以进入、执行什么能力 | 以对应成员读取准入并执行相关动作 |
| 环境地址、凭据、投递通道与执行人 | 资源在当前企业环境如何连接和运行 | 目标绑定正确，实际操作有对应结果 |
| Host/Client 插件和页面 | Workforce 装入企业代码及界面 | 入口与处理器加载，页面能完成业务 |
| 在线智能体定义 | 指令和工具声明生效 | 定义已更新，工具可由宿主路由并完成动作 |

选择资源不授予数据权限；停用应用、撤权、删除模型/数据分别处理。模型保存通常直接生效，不假设草稿/发布双态；破坏性字段变更需处理存量数据。

升级、卸载与中断恢复见[生命周期](lifecycle.md)，变量、设置和 Token 见[运行配置](configuration-and-api.md)。安装受理后核对操作终态及当前组件，目录出现名称不足以证明生效。

认证按入口合同：当前应用正式函数要求登录 JWT，记录和集成运行 API 按对外目录支持 API Token；目录列出路由不等于接受所有 Token。

`.appkg` 交付平台资源，宿主另行交付 Node/React 代码；仅更新本次变化涉及的制品与配置。

## 定位业务结果

按动作追踪：记录看 ID/冲突，HTTP 看远端状态，编排看输出/错误码，Routine/Trigger 看运行，投递看通道结果，附件看上传与引用，工具看处理器返回。启动成功仅说明入口运行。

统一搜索须明确各来源、可见范围、分页与索引时效，并复用已有服务；门户搜索框不代表覆盖所有系统。

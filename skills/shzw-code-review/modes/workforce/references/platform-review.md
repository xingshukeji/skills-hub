# Workforce 平台审查入口

本页只用于 Workforce 平台维护。先通过当前工作空间入口定位 Workforce 的责任项目；下列源码相对该项目根，文档按该项目入口的编号和主题定位。安装技能的其他项目不因此承担这些内部文档。

本页是审查选择与追踪方法，业务规则仍由下列正式来源持有。源码和测试路径是调查起点，不是完整实现清单；每次用实际引用继续追踪，路径失效时修正入口，不按旧路径推断产品仍存在。未命中本页的业务从项目入口查其正式所有者，不把本页样例数量当作平台覆盖范围。

## 业务选择

| 用户动作或变更 | 先进入的检查范围 | 必须连到的后续结果 |
|---|---|---|
| 登录、恢复会话、切租户、退出或调整资格 | 成员与租户 | 原业务是否继续；旧主体的请求和结果是否失效 |
| 发消息、退群、引用、唤醒 AI 或接收回复 | 消息与 AI | 当前可读内容、明确消息投递与原生运行分别成立 |
| 保存任务、交办、改派、请求执行或完成 | Task | 同一任务的当前责任、工具写入和执行对话资格 |
| 隐藏菜单、选择模块、裁剪、打开或安装应用 | 应用组合与独立应用 | 路由、实际准入、业务请求与资源生命周期 |
| 登记顾客、修改资料、继续接待或同事协作 | 业务资料与本人会话 | 同一业务记录、本人历史、获权共享和冲突处理 |
| 启动、诊断、打包、连接 Runtime 或清理旧入口 | 启动与交付 | 当前配置、实际消费来源、原状态与当前业务入口 |

## 成员与租户

读取DOC-0002 公共租户会话与服务配置；涉及完整人员接入再读 DOC-0016 BL-USER-01。

检查认证身份、租户成员、应用准入、业务权限及数据范围是否分别由当前事实确认。特别追踪 `context`：切换成功后的 Cookie、旧标签页写入、上传、内嵌应用及实时连接是否仍属于正确主体。目标租户不可进入时，应核对原会话如何保留；退出与切换竞争时，迟到结果不能重新装入旧身份。不要把单个应用拒绝解释成全局登录失效。

源码起点：workforce-sessions.mjs（目标项目的 `src/backend/platform/workforce-sessions.mjs`）、tenant-services.mjs（目标项目的 `src/backend/platform/tenant-services.mjs`）。读调用方时继续追到对应插件的实际业务动作。现有反例入口：tenant-sessions.test.mjs（目标项目的 `tests/tenant-sessions.test.mjs`），其中旧标签页使用新 Cookie、目标租户失败及迟到恢复分别检查不同结果。

## 消息与 AI

读取 ProductContract 中消息、参与资格与 AI 员工的规则，以及 DOC-0003和 DOC-0004 基础沟通来源；命中运行会话再读 DOC-0008。

先核对同一 Channel、Message 和当前阅读资格，再检查列表、搜索、引用及实时队列是否保持相同边界。退群或撤权发生在发送排队期间时，不能只看下一次 HTTP 是否拒绝；继续检查排队数据与活动连接。

AI 唤醒需追到真实已发表消息及目标 AI 的接收资格。分别检查私聊、结构化提及、回复、重叠去重和普通群消息。运行返回最终文本与明确调用消息工具产生不同结果；不能由前者补造消息、未读或 Task 完成。多个 AI 使用各自身份和上下文；咨询不因没有 Task 而被阻止。

源码起点：messaging Host（目标项目的 `src/backend/plugins/messaging/host/index.mjs`）、ai-conversation-service.mjs（目标项目的 `src/backend/plugins/messaging/host/services/ai-conversation-service.mjs`）及其频道服务。现有反例入口：group-revocation-delivery.test.mjs（目标项目的 `tests/group-revocation-delivery.test.mjs`）、ai-conversation-service.test.mjs（目标项目的 `tests/ai-conversation-service.test.mjs`）。

## Task

读取DOC-0009的生命周期、执行矩阵、受限 Task 工具和定向验证。基础语义和已确认增量沿该文档引用的 ProductContract。来源冲突按项目入口处理，不能由当前代码裁决。

从保存草稿、确认交办和实际改派进入，核对单一负责人及指派版本何时变化。人工负责、AI 负责和本人主动请求智能体执行分别追踪，不能用一个“运行成功”覆盖三者。普通编辑、最终回复、运行终态及明确 Task 工具更新分别观察。

任务暂停、完成、取消或改派后，检查旧员工执行号与本人工作台授权是否仍可回写；改派后再改回也不能复活旧授权。读取“执行对话”时核对当前 Task.Read 和任务关联，不把会话创建者凭据或工作台私人历史交给任务读者。当前目标包缺少指派版本时，按既有设计报告限制，不宣称已经识别完整改派历史。

源码起点：tasks 路由（目标项目的 `src/backend/plugins/tasks/host/routes.mjs`）、task-workbench-service.mjs（目标项目的 `src/backend/plugins/tasks/host/services/task-workbench-service.mjs`）、platform-workforce-service.mjs（目标项目的 `src/backend/platform/platform-workforce-service.mjs`）。现有反例入口：ai-task-service.test.mjs（目标项目的 `tests/ai-task-service.test.mjs`）、task-execution-conversation.test.mjs（目标项目的 `tests/task-execution-conversation.test.mjs`）。

## 应用组合与独立应用

读取DOC-0007 当前组合、DOC-0013 成员自由组合及 DOC-0010 应用开发与应用市场。

先区分显示偏好、成员选择、组合裁剪、用户准入和租户安装。隐藏邮件或任务菜单后，直接路由仍应按活动组合判断；裁剪或缺少页面实现后，显式目标不能落到默认页面。检查 Host 贡献、Client 页面、路由、业务请求、订阅与关闭是否一起变化；tasks 退出还需追踪可选的 messaging-tasks 消费者，消息业务保持自己的边界。

应用市场同时涉及已上架包、租户安装与本人可打开目录。分别核对数据来源和准入，不能用其中一个状态补出另外两个。当前应用开发及市场页面由统一应用市场承接；先从 Workforce Host 和 storefront 追到实际提供者，再审查页面。独立邮箱的业务会话归 `applications/mail`；门户目录和打开动作不代替邮箱准入。

源码起点：portal-routes.mjs（目标项目的 `frontend/src/runtime/portal-routes.mjs`）、app-center Host（目标项目的 `src/backend/plugins/app-center/host/index.mjs`）、application-storefront.mjs（目标项目的 `src/backend/runtime/application-storefront.mjs`）。现有反例入口：portal-route-availability.test.mjs（目标项目的 `tests/portal-route-availability.test.mjs`）、member-composition.test.mjs（目标项目的 `tests/member-composition.test.mjs`）、application-management-storefront-http.test.mjs（目标项目的 `tests/application-management-storefront-http.test.mjs`）。组合实测方法使用原 [组合与裁剪](https://github.com/xingshukeji/skills-hub/blob/main/skills/shzw-workforce-business-development/modes/composition/GUIDE.md)。

## 业务资料与本人会话

读取 DOC-0016 BL-RETAIL-01，再按其来源进入 DOC-0011与 DOC-0012。

沿同一顾客记录检查查找、登记、修改、保存回读和再次进入。姓名或手机号变化不能改写记录身份；切换顾客不能改绑已有会话。资料编辑不应因没有 AI 会话而失效；另一获权店员能读共享业务事实，不因此取得原店员的私人对话。

字段、可空、可写及选项来自目标元数据。冲突后核对是否保留同事已保存内容；写入结果未知时先查原记录，不重复登记。智能体说“已保存”不代替工具结果和记录回读。默认铵帮组合与通用门店对象按实际配置区分，不直接套用角色或资源包。

源码起点：retail-assistant Host（目标项目的 `src/backend/plugins/retail-assistant/host/index.mjs`）、customer-fields.mjs（目标项目的 `src/backend/plugins/retail-assistant/host/customer-fields.mjs`）、ConversationWorkspace.tsx（目标项目的 `frontend/src/plugins/workbench/workspace/ConversationWorkspace.tsx`）。现有反例入口：retail-customer-list.test.mjs（目标项目的 `tests/retail-customer-list.test.mjs`）、record-metadata.test.mjs（目标项目的 `tests/record-metadata.test.mjs`）、assistant-workspace.test.mjs（目标项目的 `tests/assistant-workspace.test.mjs`）。

## 启动与交付

读取 RUN-0011 确定当前统一宿主与来源；配置和恢复沿 RUN-0001，组合归属沿 DOC-0007。命令和参数留在 Runbook，不在本页复制。

沿“显式输入 → 配置解析 → 子进程或公共包 → 请求消费者”核对同一应用、租户、地址和可写目录。开发标签不能隐式造身份；可选 OIDC 服务地址为空、未设置与明确设置分别检查。启动、诊断和 Runtime 使用同一公开契约；诊断说明不成为启动输入。

流式会话检查首包前取消、响应头后取消、正常结束和客户端断开。持续事件流不套普通 JSON 请求的结束条件；取消须释放对应请求与读取资源，迟到结果不能进入旧主体或旧页面。

清理退役入口时，沿源码导入、Vite 输入、交付输入、Host 路由、静态回退、诊断及运行说明确认实际影响。测试夹具里的旧目录可能用于证明当前交付不会打包它，应先读断言。保留原 Runtime、定义、会话及工作区；不以删除可写状态证明清理完成。

源码起点：development-configuration.mjs（目标项目的 `scripts/development-configuration.mjs`）、公共包构建（目标项目的 `scripts/build-application-package.mjs`）、Vite 输入（目标项目的 `frontend/vite.config.ts`），再按实际子应用和 Runtime 消费者追踪。现有反例入口：oidc-consumer-configuration.test.mjs（目标项目的 `tests/oidc-consumer-configuration.test.mjs`）、development-launch-inspection.test.mjs（目标项目的 `tests/development-launch-inspection.test.mjs`）、runtime-client-response-lifecycle.test.mjs（目标项目的 `tests/runtime-client-response-lifecycle.test.mjs`）、workforce-delivery.test.mjs（目标项目的 `tests/workforce-delivery.test.mjs`）。

# 平台与业务的衔接

## 选择业务承载方式

Workforce 可作为统一入口，数据和规则仍由各自负责的系统维护：

| 实现方式 | 适用情况 | 实现重点 |
| --- | --- | --- |
| XRain 原生建模 | 新业务缺少记录系统，或需要自行维护模型、规则和权限 | 对象、关联、视图、授权及业务逻辑 |
| 接入原系统 API | ERP、CRM 已有数据、流程和授权，需要增加页面或助手 | 用户身份接入、接口适配、参数与结果映射 |
| 混合实现 | 原系统承载主业务，XRain 补充跟进、辅助规则或协作数据 | 数据来源、身份映射、关联键、时效和部分失败 |

例如库存查询直接使用当前用户的 ERP API，设备维修可在 XRain 建模，售后助手可读 ERP 订单并在 XRain 记录回访。原系统已有“提交订单”操作时复用它，本地记录修改不能代替原系统提交。

跨系统引用保留来源系统、来源租户和外部记录 ID，业务编号用于展示。外部 ID 文本不构成原生 Lookup；同步副本需明确可写字段、时效及查询或历史用途。接法见[系统集成](integration.md)。

## XRain、Workforce 与智能体 Runtime

| 部分 | 提供的能力 | 业务需要补充 |
| --- | --- | --- |
| XRain | 模型与记录、查询统计、组织授权、函数编排、自动化、集成投递、配置及生命周期 | 业务模型、规则、接口映射、职责与环境配置 |
| Workforce | 门户、登录与租户上下文、导航插件、人员沟通、Task、会话工作区、通用记录交互 | 企业页面、业务服务及公共组件组合 |
| 智能体 Runtime | 智能体定义、模型与工具配置、原生 Session、执行、历史及工作区 | 业务指令、工具处理器与任务上下文 |

记录 API 的 Runtime 指业务数据访问；智能体 Runtime 指对话与工具执行。业务记录、Task、会话和单次运行各有身份与状态。

编排执行确定的业务逻辑，Routine 负责调度。审批、会签和人工处理使用原系统流程，或由业务状态、操作与任务协作实现；不要把编排当成通用拖拽审批流。

元数据既声明结构，也声明权限、候选、呈现、视图与调用合同。确认每项配置由谁消费：支持协议的组件读取字段呈现，业务处理器检查自定义权限，业务表单显式使用记录类型范围。细节见[元数据与前端](metadata-and-ui.md)。

## 按需发现当前能力

按[业务 API](business-api.md)选择接口族、请求和返回；按 [Skill 导航](../SKILL.md)进入具体专题。发现入口按当前问题使用：

- 当前主体：`XRainRuntimeClient.context()`；完整 HTTP 上下文与 SDK 返回的差异见业务 API。
- 业务模型：`accessibleBusinessObjects()`、`describeBusinessObject(entityCode)`；查询能力、视图和候选由相应业务接口提供。
- 模型设计：CLI `metadata entities`、`metadata standards`、`metadata describe <entity>`，对应 GET `/api/metadata/v1/objects`、`/api/metadata/v1/standards/entity-design`、`/api/metadata/v1/entities/{entityCode}/describe`。

以上 SDK 方法由 `@xrain/workforce-application/server` 的 `XRainRuntimeClient` 提供。管理目录与业务发现权限不同，普通录入不需要元数据管理权；目录中存在一项能力也不等于当前主体获准执行。版本依据、真实调用及未验证部分见[实测范围](api-verification.md)。

## 区分业务与配置身份

| 名称 | 用途 |
| --- | --- |
| `tenantId`、`userId` | 当前系统的实际租户和用户；跨系统 ID 未必相同 |
| `applicationId` | 租户内应用的准入、资源和授权 |
| `packageId`、包 `versionId` | 可安装资源包及其版本，与函数版本分别识别 |
| 对象 ID、`entityApiName`、`entityCode` | 模型引用、定义名称和运行寻址；User 分别为固定元数据 ID、User、runtime.User |
| `fieldApiName`、标签 | 稳定字段身份与显示文本，如 `status__c` 和“处理状态” |
| `recordId`、外部记录 ID | 各系统中的记录身份；业务编号或标题不代替它们 |
| `agentId`、`sessionId` | 智能体定义与会话，不代替业务记录或人员 |
| 连接器凭据、用户凭据 | 分别以企业集成主体或个人主体执行 |

定位问题时沿实际负责方排查：原系统拒绝看其身份与权限，字段缺失看目标元数据，工具不可用看定义与宿主装配，执行失败看执行者、业务状态与运行结果。

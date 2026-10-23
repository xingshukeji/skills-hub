# 平台与业务的衔接

## 选择业务承载方式

Workforce 可提供统一入口，数据和规则由各自系统维护：

| 实现方式 | 适用情况 | 实现重点 |
| --- | --- | --- |
| XRain 原生建模 | 新建业务记录、规则和权限 | 对象、关联、视图、授权、逻辑 |
| 接入原系统 API | ERP/CRM 已有数据、流程与授权 | 用户身份、接口及结果映射 |
| 混合实现 | 原系统主业务 + XRain 补充事实 | 数据归属、关联键、时效、部分失败 |

例如库存查询用 ERP API，维修记录在 XRain 建模，售后助手读 ERP 订单并记录本地回访。原系统的提交动作直接复用。混合关联保留来源系统、租户和记录 ID，明确可编辑方与副本时效；外部 ID 文本不构成原生 Lookup，见[系统集成](integration.md)。

## XRain、Workforce 与智能体 Runtime

| 部分 | 提供的能力 | 业务需要补充 |
| --- | --- | --- |
| XRain | 模型与记录、查询统计、组织授权、函数编排、自动化、集成投递、配置及生命周期 | 业务模型、规则、接口映射、职责与环境配置 |
| Workforce | 门户、登录与租户上下文、导航插件、人员沟通、Task、会话工作区、通用记录交互 | 企业页面、业务服务及公共组件组合 |
| 智能体 Runtime | 智能体定义、模型与工具配置、原生 Session、执行、历史及工作区 | 业务指令、工具处理器与任务上下文 |

记录 API 的 Runtime 指数据访问，智能体 Runtime 指对话与工具执行；业务记录、Task、Session、Run 各有身份和状态。元数据配置由支持协议的组件和业务处理器消费，见[元数据与前端](metadata-and-ui.md)。

## 发现与定位

接口、返回及资源身份见[业务 API](business-api.md)，验证边界见[实测范围](api-verification.md)。SDK 使用 `@xrain/workforce-application/server` 的 `XRainRuntimeClient`；已有 CLI 可用 `metadata entities`、`metadata standards`、`metadata describe <entity>` 检查模型。管理目录与普通业务接口有不同权限。

排查沿实际负责方进行：原系统拒绝看其身份与权限，字段缺失看有效元数据，工具不可用看定义与宿主装配，执行失败看主体、业务状态与运行结果。

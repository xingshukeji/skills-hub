---
name: workforce-business-development
description: 基于 XRain 与 Workforce 开发企业非标业务，复用平台能力和原系统 API，完成建模、授权、业务逻辑、自动化、页面与智能体工具。
---

# Workforce 企业业务开发

在当前项目实现业务，沿用已有需求、模型、身份与接入方式。按闭源条件使用交付文档、公共包导出、受支持 API 和企业代码；不依赖平台源码、内部导入路径或相邻仓库。示例采用通用业务名称和命名空间。

- 先将需求拆成平台已实现、需配置接入、需新增逻辑。复用标准字段、授权、分享、历史、恢复和原系统操作，只建独立业务事实。
- 核对目标既有资源后增补，保留租户配置与稳定身份。全员能力、User 和默认选项见初始化基础。
- 元数据要接到页面、工具或处理器；分别落实推荐呈现、服务端约束与业务规则。
- 区分 HTTP、SDK、管理请求和包资源，使用实际合同。缺口明确标注，继续完成不依赖它的部分。
- 验证受影响的数据、权限和交互；交付时区分模型生效、宿主加载和业务执行结果。

只读取当前问题所需的专题：

| 问题 | 参考 |
| --- | --- |
| 需求复用与模型 | [对象自带能力](references/object-foundation.md)、[建模](references/modeling.md) |
| 承载方式与预置资源 | [平台与业务](references/platform.md)、[初始化基础](references/initialized-platform.md) |
| 接口与数据操作 | [业务 API](references/business-api.md)、[批量/统计/导出](references/data-operations.md) |
| 权限与记录协作 | [授权](references/authorization.md)、[人员/组织/分享/交接](references/organization-and-collaboration.md) |
| 外部系统与配置 | [集成](references/integration.md)、[变量/设置/Token](references/configuration-and-api.md) |
| 自动执行与时间 | [函数/Trigger/Routine](references/automation.md)、[地区与日期](references/regional-context.md) |
| 页面与智能体 | [元数据与前端](references/metadata-and-ui.md)、[宿主与工具](references/implementation.md)、[智能体选用](references/agent-access.md) |
| 协作服务 | [消息/附件/Task](references/shared-services.md)、[个人邮箱](references/personal-email.md) |
| 变更与恢复 | [模型和应用生命周期](references/lifecycle.md) |
| 案例与验证依据 | [企业销售案例](references/enterprise-case.md)、[API 实测范围](references/api-verification.md) |

相对路径以本 skill 目录为基准；Workforce 使用加载结果的 `resourceBase.path`。

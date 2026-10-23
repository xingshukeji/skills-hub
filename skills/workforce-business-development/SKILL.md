---
name: workforce-business-development
description: 结合 XRain 与 Workforce 开发企业非标业务，复用平台资源和已有系统 API，完成元数据驱动的建模、授权与交互，以及业务逻辑、自动化、页面和智能体工具。
---

# Workforce 企业业务开发

在当前项目中直接完成业务实现。可选择 XRain 原生建模、已有系统 API 接入或混合方案；接续已有需求、模型和技术选择。

按闭源平台的接入条件工作：使用交付文档、公共包的导出与类型、受支持的 API/管理入口及企业自己的代码。本 skill 独立可用，不依赖平台源码、内部导入路径、相邻仓库或平台构建产物。

按当前问题选读：

| 当前要解决的问题 | 参考 |
| --- | --- |
| 接口选择、请求/返回、SDK 差异与实测范围 | [业务 API](references/business-api.md) |
| 原生建模、原系统接入或混合实现 | [平台与业务](references/platform.md) |
| 全员权限、User、标准字段、默认选项 | [初始化基础](references/initialized-platform.md) |
| 权限声明、字段呈现、候选、视图与前端消费 | [元数据与前端](references/metadata-and-ui.md) |
| 对象、字段、关联、查询与保存 | [建模](references/modeling.md) |
| 批量写入、计数、去重、聚合与导出 | [数据操作](references/data-operations.md) |
| 原系统用户身份、连接器与 HTTP 接口 | [系统集成](references/integration.md) |
| 职责、权限集、记录范围与执行身份 | [业务授权](references/authorization.md) |
| 人员、组织条件、人工分享与 Owner 交接 | [组织与协作](references/organization-and-collaboration.md) |
| 变量、个人设置与 API Token | [运行配置](references/configuration-and-api.md) |
| 函数、JavaScript 编排、Trigger 与 Routine | [自动化](references/automation.md) |
| 页面、宿主、插件与智能体工具 | [业务接入](references/implementation.md) |
| 智能体订阅、应用选用与使用资格 | [智能体选用](references/agent-access.md) |
| 消息、文件、Task 与应用交付 | [公共服务](references/shared-services.md) |
| 邮箱接入、检索、正文与草稿 | [个人邮箱](references/personal-email.md) |
| 字段部署、删除、回收站与应用升级恢复 | [生命周期](references/lifecycle.md) |
| 语言、显示时区、业务日期与调度 | [时间上下文](references/regional-context.md) |
| 企业实践 | [铵帮案例](references/anbang.md) |

- 从业务动作确定数据来源、规则、参与者和执行身份。复用原系统已有操作，按需建模新增事实；混合实现明确各系统的维护责任。
- 主动复用已初始化资源，核对目标状态后增补。例如全员能力使用 `xrain-all-employees` 或包的全员贡献，人员字段引用受保护 User；保留租户已有配置。
- 把元数据声明接到实际消费者，区分推荐呈现、服务端约束和业务处理器负责的行为。配置保存成功不代表页面、工具或业务动作已经实现。
- 按目标 API 和项目所用公共包适配字段与响应；区分 HTTP、SDK、管理请求和包资源，不补造结构。缺少具体合同时说明缺口，并继续完成不依赖它的部分。

沿用项目已有 SDK、管理入口或 CLI，以及稳定模型身份和配置来源。验证改动涉及的数据、权限与交互，交付实际修改、验证结果及具体缺口；分别说明模型资源、宿主加载和业务运行的完成状态。

参考文件相对本 skill 目录读取；Workforce 中以加载结果的 `resourceBase.path` 为基准。

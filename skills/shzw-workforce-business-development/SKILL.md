---
name: shzw-workforce-business-development
description: 使用 XRain 与 Workforce 的既有能力完成业务建模与开发、接入独立应用，或维护公共宿主的组合与裁剪。用于对象字段和 E-R 关系核对、销售接待、资料协作、记录文件导入导出与业务编排、业务页面和智能体工具，以及“像邮箱一样接入应用”“裁掉模块后还有残留”。按真实业务和应用范围选择平台复用、配置、实现与验证；公共宿主修改由 Workforce 责任项目承担。
metadata:
  author: 苏州苏宏助为智能科技有限公司
  source: SKILL.md
  documentation: https://xingshukeji.github.io/xrainTrain/developers/skills
  products: XRain, XRain Workforce
---

# Workforce 业务与应用开发

先确定本轮是理解现状、只读审查还是实施。用户只要求解释或评估时沿真实入口和已有证据回答，不自动修改配置、启动服务或要求实跑；已有实施授权继续覆盖原业务结果。

涉及企业业务能力时，按[产品知识与责任项目](references/knowledge-ownership.md)定位所有者，只读取命中的专题。仅维护公共宿主或裁剪时直接进入下方组合方法，不强制先梳理业务主线。

在当前项目实现业务，沿用用户已确认的业务要求、产品契约、身份与接入方式。企业应用按闭源条件使用交付文档、公共包导出、受支持 API 和企业代码；不要求平台源码、内部导入路径或相邻仓库。公共宿主维护按实际责任项目读取源码与测试。示例采用通用业务名称和命名空间。

- 对象、字段和 E-R 关系先按[建模](references/modeling.md)核对材料依据、记录粒度、关系语义与完整字段；绘图工具负责表达。纯方案制定或评审由 `shzw-solution` 组织，按需读取此专题。
- 业务开发先按[业务主线](references/business-mainlines.md)找到本次要完成的工作及前后衔接，复用已确认部分，只处理实际差异。批量或规模会影响结果时，提前核对实际工作量、平台机制和代表性输入；单独技术问题直接进入对应专题。
- 再将业务动作拆成平台已实现、需配置接入、需新增逻辑。复用标准字段、授权、分享、历史、恢复和原系统操作，只建独立业务事实。
- 老系统数据、流程与接口已管理完善时，使用连接器和请求，按需通过业务编排组合并发布 HTTP 接口，无需先创建业务对象。只有新增独立业务事实时才建模；原系统与新增事实并存时分别明确数据归属。
- 核对目标既有资源后增补，保留租户配置与稳定身份。全员能力、User 和默认选项见初始化基础。
- 元数据要接到页面、工具或处理器；分别落实推荐呈现、服务端约束与业务规则。
- 区分 HTTP、SDK、管理请求和包资源，使用实际合同。缺口明确标注，继续完成不依赖它的部分。
- 页面涉及截图、圈注或多处纠正时，先逐项列出要改的位置及需保留的行为，核对原图、实际页面和相关定义；修改后逐项对照实际页面，并复验受影响的保存和再次进入。仅授权视觉调整时保留业务行为；无法复验的位置单独报告。简单文案修改直接完成。
- 首次交付前沿实际入口核对受影响消费者、身份与数据流，以及相关失败、重试或迟到结果。用原使用者验证业务操作、持久结果及继续处理；交付时区分业务确认、实现覆盖和本次实测覆盖，并更新原主线的差异与运维入口。

涉及独立应用接入或公共宿主组合时，先读取已有配置与公开合同。公开 SDK 消费不要求私有源码；维护宿主才进入 Workforce 项目源码。复用应用身份、认证客户端与已有配置，区分发布、当前用户准入和业务权限；卡片可见、安装成功及业务可用分别核验。保留 Runtime、定义、会话、工作区和业务数据。

实施或修复时，沿目录、实际打开、登录、原业务操作及退出清理验证；按受影响应用、实际依赖和相邻裁剪选择组合。公共加载或依赖合同变化，或用户明确要求整体装配结论时，才扩展完整组合。真实业务操作不能以构建、导航、HTTP 状态或测试数量代替。

只读取当前问题所需的专题：

| 问题 | 参考 |
| --- | --- |
| 业务落地、长主线复用及跨环节衔接 | [业务主线](references/business-mainlines.md) |
| 需求复用与模型 | [对象自带能力](references/object-foundation.md)、[建模](references/modeling.md) |
| 承载方式与预置资源 | [平台与业务](references/platform.md)、[初始化基础](references/initialized-platform.md) |
| 接口、数据及文件导入导出 | [业务 API](references/business-api.md)、[批量/统计/文件操作](references/data-operations.md) |
| 权限与记录协作 | [授权](references/authorization.md)、[人员/组织/分享/交接](references/organization-and-collaboration.md) |
| 外部系统与配置 | [集成](references/integration.md)、[变量/设置/Token](references/configuration-and-api.md) |
| 自动执行与时间 | [函数/Trigger/Routine](references/automation.md)、[地区与日期](references/regional-context.md) |
| 页面与智能体 | [元数据与前端](references/metadata-and-ui.md)、[宿主与工具](references/implementation.md)、[智能体选用](references/agent-access.md) |
| SDK 取得、版本、公开导出与调用 | [Workforce SDK](references/workforce-sdk.md) |
| 独立应用接入、认证与业务使用 | [应用接入](modes/integration/GUIDE.md) |
| 公共宿主装配、裁剪和生命周期 | [组合与裁剪](modes/composition/GUIDE.md) |
| 协作服务 | [消息/附件/Task](references/shared-services.md)、[个人邮箱](references/personal-email.md) |
| 变更与恢复 | [模型和应用生命周期](references/lifecycle.md) |
| 案例与验证依据 | [企业销售案例](references/enterprise-case.md)、[API 实测范围](references/api-verification.md) |

相对路径以本 skill 目录为基准；Workforce 使用加载结果的 `resourceBase.path`。

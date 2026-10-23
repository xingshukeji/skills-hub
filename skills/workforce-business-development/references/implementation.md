# 业务实现与接入

## 选择承载业务逻辑的地方

按业务动作选择承载位置：

| 方式 | 适用情况 | 需要落实的内容 |
| --- | --- | --- |
| 对象、视图与通用记录页面 | 主要是字段录入、列表、详情、关联和筛选 | 模型、呈现、权限和查询条件 |
| 平台函数或编排 | 使用平台数据/接口能力，或需管理可选函数版本 | 输入输出契约、受控源码、资源引用与执行上下文 |
| Trigger / Routine | 记录变化或时间驱动的业务动作 | 触发条件、执行内容、参数、执行人及重复执行语义 |
| 企业宿主业务服务 | 算法、复杂业务状态或需项目依赖的处理 | 业务模块与处理器、平台客户端、可信身份和结果 |
| 连接器 / HTTP 接口 | 复用外部服务或企业现有系统 | 请求与响应映射、目标配置、远端执行身份、失败及未知结果 |

平台使用受控 JavaScript 和已登记 callable，见[自动化](automation.md)。依赖项目库的算法留在企业宿主；原系统已有操作直接复用，见[系统集成](integration.md)，无需先建平台对象。

## 页面、宿主与插件

使用已发布包的公开入口：

| 导出入口 | 可接入内容 |
| --- | --- |
| `@xrain/workforce-application/host` | `bootWorkforceApplication`、`createWorkforcePortalApplication` 与应用装配类型 |
| `@xrain/workforce-application/server` | `XRainRuntimeClient` 等服务端公共能力 |
| `@xrain/workforce-application/client` | `CustomerEntry`、`ClientAssistantWorkspace` 等客户端组件与对应类型 |
| `@xrain/xrain-agent-runtime/host` | `ServiceToolInvocation`、`ServiceToolInvoker` 等宿主工具接入类型 |

`bootWorkforceApplication` 选项包括 `projectRoot`、`profilePath`、`createApplication`；回调取得公共上下文、插件管理器和 Runtime 接入函数。应用返回 `handle(request, response)`，可另提供 `invokeTool`、`close`。`createWorkforcePortalApplication` 的 `createBusiness` 可取得会话凭据租约入口；HTTP 处理器沿已有会话取得可信上下文并按约定释放租约。

完整启动选项和组件 props 读取当前包的公开类型，不导入内部实现。已有宿主直接增加业务模块；Host/Client 插件沿用项目 profile、入口与生命周期，见[企业销售案例](enterprise-case.md)。

通用记录界面消费字段呈现、选项与读写能力；自定义页面也需主动接入有效描述，见[元数据与前端](metadata-and-ui.md)。原系统数据按其 API 展示；混合页面标明来源和可操作范围，共用适配层处理身份、单位、选项及错误。保存实际 ID 和 value，显示 label。

页面离开、插件卸载、退出或切换租户时传递取消信号，防止旧响应覆盖新页面。导航显示、页面装入和服务端授权分别检查。

## 将业务操作提供给智能体

业务指令说明目标、输入和结果含义；工具声明动作，处理器执行查询、计算或写入。页面、工具和定时任务共用业务操作，处理器可访问 XRain、原系统或两者。

以下为 Runtime `assistantTools` 数组中的一个 `AssistantTool`，不是完整定义或导入请求；按业务替换名称和参数，通过项目公开入口更新在线定义：

```json
{
  "name": "service_findRepairRequests",
  "serviceId": "repair-service",
  "operation": "findRepairRequests",
  "description": "按申请状态查询当前执行者有权访问的维修申请。返回真实分页结果。",
  "parameters": {
    "type": "object",
    "properties": {"status": {"type": "string"}},
    "additionalProperties": false
  }
}
```

宿主装入处理器。`ServiceToolInvocation` 提供 `principal`、`execution`、会话标识和 `signal`；`applicationId`、`businessTargetRef` 可选，仅在业务需要时要求绑定。租户和执行身份来自验证过的上下文，不接受工具参数覆盖。

服务端接线示例：

```ts
import { XRainRuntimeClient } from '@xrain/workforce-application/server';
import type { ServiceToolInvocation, ServiceToolInvoker } from '@xrain/xrain-agent-runtime/host';

type FindRepairRequests = (input: unknown, context: {
  client: XRainRuntimeClient;
  principal: ServiceToolInvocation['principal'];
  applicationId: ServiceToolInvocation['applicationId'];
  businessTargetRef: ServiceToolInvocation['businessTargetRef'];
  signal: AbortSignal;
}) => Promise<unknown>;

export function createRepairInvoker(findRepairRequests: FindRepairRequests): ServiceToolInvoker {
  return async call => {
    if (call.serviceId !== 'repair-service' || call.operation !== 'findRepairRequests') {
      throw new Error('Unsupported service operation');
    }
    return findRepairRequests(call.arguments, {
      client: XRainRuntimeClient.fromExecution(call.execution, { signal: call.signal }),
      principal: call.principal,
      applicationId: call.applicationId,
      businessTargetRef: call.businessTargetRef,
      signal: call.signal,
    });
  };
}
```

项目实现 `findRepairRequests` 的输入校验和查询，将返回的处理器接到 `invokeTool` 或已有分派器，并保留其他服务路由。此代码仅接线；页面可向同一业务函数传入自己的已认证客户端。

实际调用需同时满足工具声明、处理器装入、定义使用资格和执行者业务权限；按缺口处理，声明工具不授予管理权限。

返回实际结果、业务状态及必要依据，区分未知、空集、缺少输入和已保存。金额计算、审批资格等规则在业务函数实现，由智能体解释；是否需确认由业务动作决定。

## 组合其他平台能力

函数版本、应用采用、Trigger 和 Routine 见[自动化](automation.md)；身份转发和连接器见[系统集成](integration.md)；消息、文件、Task 和资源生效见[公共服务](shared-services.md)。仅包装业务需要的操作。

例如售后工具按当前用户身份读取 ERP 订单，在 XRain 保存回访并关联附件；页面与智能体使用同一结果，后续 Task 或通知显式接续。跨系统部分失败沿集成层恢复。

## 从一个业务动作完成交付

例如“完成工单”：读取工单、检查分派和状态、按必要旧值条件保存、显示结果。多人开发共享字段、参数、结果语义和配置键。

按改动验证计算、冲突、主体权限及实际入口；资源包、宿主代码和在线定义分别确认生效。

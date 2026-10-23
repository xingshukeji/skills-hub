# 业务实现与接入

## 选择承载业务逻辑的地方

按业务动作与项目现状选择平台配置、函数或宿主代码：

| 方式 | 适用情况 | 需要落实的内容 |
| --- | --- | --- |
| 对象、视图与通用记录页面 | 主要是字段录入、列表、详情、关联和筛选 | 模型、呈现、权限和查询条件 |
| 平台函数或编排 | 使用平台数据/接口能力，或需管理可选函数版本 | 输入输出契约、受控源码、资源引用与执行上下文 |
| Trigger / Routine | 记录变化或时间驱动的业务动作 | 触发条件、执行内容、参数、执行人及重复执行语义 |
| 企业宿主业务服务 | 算法、复杂业务状态或需项目依赖的处理 | 业务模块与处理器、平台客户端、可信身份和结果 |
| 连接器 / HTTP 接口 | 复用外部服务或企业现有系统 | 请求与响应映射、目标配置、远端执行身份、失败及未知结果 |

平台使用受控 JavaScript 和已登记 callable，具体示例见[函数、编排与自动化](automation.md)。需要项目依赖的算法可以留在企业宿主代码。原系统 API 已有业务逻辑时复用该操作，用户身份转发与共享连接器接入见[系统集成](integration.md)，不要求先建平台对象。

## 页面、宿主与插件

项目使用已发布包的公开入口，不导入包内部实现路径。当前核对的入口包括：

| 导出入口 | 可接入内容 |
| --- | --- |
| `@xrain/workforce-application/host` | `bootWorkforceApplication`、`createWorkforcePortalApplication` 与应用装配类型 |
| `@xrain/workforce-application/server` | `XRainRuntimeClient` 等服务端公共能力 |
| `@xrain/workforce-application/client` | `CustomerEntry`、`ClientAssistantWorkspace` 等客户端组件与对应类型 |
| `@xrain/xrain-agent-runtime/host` | `ServiceToolInvocation`、`ServiceToolInvoker` 等宿主工具接入类型 |

在核对的宿主类型中，`bootWorkforceApplication` 的选项包含 `projectRoot`、`profilePath`、`createApplication`；回调取得公共上下文、插件管理器和 Runtime 接入函数。返回的应用提供 `handle(request, response)`，还可提供 `invokeTool`、`close` 等。`createWorkforcePortalApplication` 的 `createBusiness` 回调可取得会话凭据租约入口，企业 HTTP 处理器通过已有会话取得可信上下文，沿用租约的有效性和释放约定。

这些是接入位置说明，不是完整启动配置；其余必需选项和组件 props 读取当前包的对外类型。已有企业宿主直接增加业务模块即可。采用 Host/Client 插件的项目沿用其 profile、插件入口与生命周期，案例中的具体注册方式见[铵帮案例](anbang.md)。

通用记录界面消费平台提供的字段呈现、选项与读写能力，具体参数通过组件公开接口传入。配置如何变成有效描述、默认与覆盖如何保存、选项和视图如何消费，见[元数据与前端](metadata-and-ui.md)。企业自定义页面需要接入这套描述，不能把新增配置等同于任意 React 页面都会自动变化。原系统的数据可由业务组件按其 API 展示，不必伪造平台对象描述。混合页面明确字段来源与可操作范围，共用的业务适配层处理身份、单位、选项和错误语义。标签与选项值分开，保存采用实际接口身份和真实值。

页面离开、插件卸载、退出或切换租户会使原上下文失效；将现有取消信号传到业务请求，旧响应不覆盖新页面。导航是否显示、页面是否装入、服务端是否允许操作分别检查，避免把显示配置当授权。

## 将业务操作提供给智能体

业务指令说明用户目标、输入含义、结果如何解释；工具声明描述可执行动作；服务处理器完成查询、计算或写入。处理器可以访问 XRain、原系统或两者，并非每个工具都必须有一个平台对象。复用已有业务操作，避免在页面、工具和定时任务里分别复制规则。

以下符合已发布 Runtime 的 `AssistantTool` 声明形状，也是铵帮使用的服务工具方式。它是智能体 `assistantTools` 数组中的一项，不是完整智能体定义或导入请求；名称和参数按业务替换，在线定义由项目使用的对外入口更新：

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

工具处理器由宿主装入。`ServiceToolInvocation` 提供 `principal`、`execution`、会话标识和 `signal`；`applicationId` 与 `businessTargetRef` 是可选的，不能假设所有调用都有固定应用或业务对象。需要这些绑定的操作在业务入口检查，普通查询不必额外要求固定业务目标。租户和执行身份来自已验证上下文，不接受工具参数覆盖。

下面是服务端接线示例，把工具调用交给项目自己的业务函数：

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

`findRepairRequests` 由业务项目实现，负责校验输入并按业务规则查询；平台访问通过执行绑定客户端完成。把返回的处理器接到应用的 `invokeTool` 或项目已有服务分派器，多个服务共存时保留其他服务路由。这段代码只完成接线，不会创建智能体定义、授予权限或实现查询。页面处理器可以调用同一个业务函数，传入该页面的已认证客户端。

“已声明工具”“已装入处理器”“该定义允许使用”“执行者有业务权限”共同决定实际可调用性。给 skill 或工具写描述不会自动开通平台权限。调试时沿具体缺口处理，不为工具声明顺带给用户管理权限。

返回值宜包含实际结果、业务状态、必要的依据或可继续定位；未知、空集、尚缺输入、保存完成由各自业务含义区分。计算金额、判断能否批准等有明确规则的操作在业务函数中实现，智能体使用其结果解释。是否需要用户确认取决于该业务动作本身，不因使用 AI 额外给所有操作加确认步骤。

## 组合其他平台能力

函数版本、应用采用、受控编排、Trigger 和 Routine 的实现见[函数、编排与自动化](automation.md)；原系统身份转发、连接器模板及远端返回处理见[系统集成](integration.md)；消息、文件、Task 和应用资源生效见[公共服务与应用交付](shared-services.md)。按当前业务动作选择相关能力，不因为有工具入口就把所有平台能力重新包装一遍。

例如售后工具可以按当前用户身份从 ERP 读取订单，在 XRain 保存新增回访，并通过既有附件服务关联材料。处理器返回各系统的实际结果，页面与智能体采用同一结果；业务需要的后续 Task 或通知作为明确操作接续。外部操作与本地保存的部分失败遵循集成层的恢复语义。

## 从一个业务动作完成交付

例如“完成工单”：读取已有工单，检查分派与状态，按必要字段条件保存结果，再由页面或工具显示。共享稳定字段、操作参数、结果语义和配置键即可衔接多人开发。

按改动验证计算样例、读写冲突、主体权限或实际入口。资源包、宿主代码和在线智能体定义分别生效，需分别确认。

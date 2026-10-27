# Workforce Application SDK 与 Agent Runtime

产品事实：Workforce；涉及 Runtime、统一认证或平台 API 时沿该能力实际所有者核对。
维护与适用：本专题由 skills-hub 维护，面向公开能力的业务使用；接口、示例与历史实测的原有适用条件继续有效。内部修改由目标项目入口定位源码与测试。

苏州苏宏助为智能科技有限公司维护 Workforce Application SDK（`@xrain/workforce-application`）和 XRain Agent Runtime（`@xrain/xrain-agent-runtime`）。[产品说明](https://xingshukeji.github.io/xrainTrain/products/) · [SDK 入门](https://xingshukeji.github.io/xrainTrain/developers/sdk) · [联系与制品接入](https://xingshukeji.github.io/xrainTrain/contact)。

## 取得与版本

SDK 通过项目约定的制品渠道交付，不是公开 npm 的匿名安装包。已有项目使用交付依赖声明与锁文件安装；首次接入取得制品、适用环境、依赖与使用条件后再安装。不推测下载 URL，不读取平台私有源码或其他项目的 node_modules。

本页读取示例按 Workforce Application 0.3.17 与 Runtime 0.2.2 核对。该范围不是最新版声明；其他版本以其公开类型为准。Workforce 宿主使用 Node.js 24。已有 npm 项目在根目录执行：

```powershell
npm ci
npm ls @xrain/workforce-application @xrain/xrain-agent-runtime
```

## 公开入口

| 包导出 | 用途 |
| --- | --- |
| `@xrain/workforce-application/server` | `XRainRuntimeClient` 等服务端公共能力 |
| `@xrain/workforce-application/host` | `bootWorkforceApplication`、`createWorkforcePortalApplication` 与宿主类型 |
| `@xrain/workforce-application/client` | 客户端组件和对应类型 |
| `@xrain/xrain-agent-runtime/host` | `ServiceToolInvocation`、`ServiceToolInvoker` 与工具执行上下文 |

组件属性和完整导出由安装包类型持有。宿主装配与工具接线见[业务实现](implementation.md)。

## XRainRuntimeClient

普通服务端请求使用受信会话取得的服务地址和租户令牌；AI 工具使用宿主提供的执行绑定。两种方式都不从页面或工具业务参数接受任意用户身份。

```js
import { XRainRuntimeClient } from '@xrain/workforce-application/server';

export async function readNote({ baseUrl, token, recordId }) {
  const client = new XRainRuntimeClient({ baseUrl, token });
  return client.get('xrainlearn__note__c', recordId);
}
```

`baseUrl` 是平台服务 origin；`token` 来自获准租户会话，不包含 `Bearer ` 前缀。`recordId` 是已存在便签的编号。该函数只演示已认证调用，业务入口仍负责按自身流程取得身份与校验输入。

| 方法 | 参数与返回 |
| --- | --- |
| `describeBusinessObject(entityCode)` | 读取当前对象描述，保留平台响应；需要该描述接口允许的身份与权限 |
| `get(entityCode, recordId)` | 读取并返回记录 JSON，没有 CLI 的 `{ok,data}` 外层 |
| `query(entityCode, query)` | 提交平台查询对象并返回查询响应；结构见[数据操作](data-operations.md) |
| `create(entityCode, values)` | 创建记录，改变数据；返回平台创建结果 |
| `update(entityCode, recordId, values, options)` | 修改记录；可用并发选项以安装版本类型为准，不丢弃原业务的旧值条件 |

失败保留 SDK 的错误状态和代码；按身份、权限、参数或传输问题处理，不将失败改成空结果。SDK 可能转换个别接口返回，因此不能由 HTTP 路径猜方法名或假定统一响应外层。

## 工具执行上下文

在 `ServiceToolInvoker` 中：

```ts
import { XRainRuntimeClient } from '@xrain/workforce-application/server';
import type { ServiceToolInvoker } from '@xrain/xrain-agent-runtime/host';

export const invokeNoteTool: ServiceToolInvoker = async call => {
  if (call.serviceId !== 'note-service' || call.operation !== 'readNote') {
    throw new Error('Unsupported service operation');
  }
  const input = call.arguments as { recordId?: unknown };
  if (typeof input?.recordId !== 'string' || !input.recordId.trim()) {
    throw new Error('recordId is required');
  }
  const client = XRainRuntimeClient.fromExecution(call.execution, {
    signal: call.signal
  });
  return client.get('xrainlearn__note__c', input.recordId);
};
```

这是处理器示例，不是完整可部署应用。宿主必须装入处理器，定义中声明 `note-service/readNote`，并允许当前主体使用相应工具和记录。执行绑定必须仍有效；保留取消信号，不把凭据返回给 AI。完整声明与装配步骤见[业务实现](implementation.md)。

原系统 API 可以由自己的 SDK、企业服务或 XRain 编排承载。`XRainRuntimeClient.fromExecution` 用于 XRain API，不负责把 XRain 身份转换为 ERP 身份，见[集成](integration.md)。

## 与编排 SDK、CLI 的区别

应用 SDK 是安装到项目中的包；`ctx.sdk.fn.invoke()` 是 XRain 注入业务编排的 callable 入口，不通过 npm 安装，也不开放 `fetch`、文件或进程能力；CLI 是独立终端入口，其 JSON 响应采用 `{ok,data}` 或 `{ok:false,error}`。

选择现有系统接口接入、新业务建模或混合实现后，再选择对应工具。SDK 或 Skill 的存在不要求业务先建模，也不扩大调用者权限。

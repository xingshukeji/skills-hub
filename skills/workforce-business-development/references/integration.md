# 原系统 API、HTTP 集成与混合数据

## 选择调用方式

| 需要实现的业务 | 调用方式 | 授权由谁落实 |
| --- | --- | --- |
| 用户查询自己的 ERP 订单或提交原系统业务动作 | 企业宿主通过原系统 SDK/API，使用该系统接受的用户身份或委托凭据 | Workforce 入口检查调用资格，原系统检查该用户的数据和动作权限 |
| 企业统一访问供应商、物流等服务 | XRain Connector + 请求模板 + HTTP 接口，使用受管集成凭据 | 平台检查接口执行资格，远端按集成主体授权；业务需要的个人范围另行落实 |
| 一个动作组合平台记录与外部接口 | 平台业务编排或企业业务服务 | 各数据源保留自己的授权，组合操作还检查业务规则 |
| 只需要在现有页面增加原系统数据 | 在已有服务适配层增加调用，页面或工具共用它 | 沿用已有会话与原系统接入，不因增加展示而复制数据模型 |

“以用户身份调用”要求原系统实际识别该用户。添加 `X-User-Id`、传入一个用户名或拿 XRain 的 token 直接请求 ERP，不自动构成委托认证。使用原系统支持的单点登录、用户授权、令牌交换或受信代理协议；由可信会话关联原系统身份、租户和凭据。

平台的原生 Connector 凭据按租户与连接器管理；受管 Connector 也可通过 `credentialVariableId` 绑定受保护变量。这些是集成凭据机制，不等于每个登录用户的 OAuth 凭据。接口模板中的 `system.actorId` 可用于约定的业务审计，但只有原系统明确认可相应受信协议时才具有代理用户的含义。

变量创建与作用域、配置是否有值、当前用户设置，以及外部程序调用 XRain 的 Token 管理，见[运行配置与 API 访问](configuration-and-api.md)。连接器引用变量 ID，不能把变量列表当成明文秘密读取接口。

## 在企业宿主中转发用户请求

把原系统 API 包装为具体业务操作，例如 `readErpOrder(orderId)`。页面和工具只提供业务参数，目标地址来自服务端配置，身份来自当前会话；原系统数据权限继续由原系统执行。原系统写入已有业务 API 时，保留其校验、版本条件和幂等约定。

下面是企业宿主的 JavaScript 示例。`acquireUserCredential` 是业务项目需要接到原系统认证的适配函数，不是 XRain 内置方法。它根据可信 `context` 取得当前用户在该 ERP 租户的凭据租约，返回 `authorizationHeader` 和 `release()`；不能接受工具参数指定用户或凭据。示例假定原系统已提供返回 JSON 的 `GET /v1/orders/{orderId}`。

```js
export function createErpOrderReader({ baseUrl, acquireUserCredential }) {
  return async function readErpOrder(input, context) {
    const orderId = input?.orderId;
    if (typeof orderId !== 'string' || !orderId.trim() || ['.', '..'].includes(orderId)) {
      throw new Error('orderId is required');
    }
    const url = new URL(`/v1/orders/${encodeURIComponent(orderId)}`, baseUrl);
    const lease = await acquireUserCredential(context);
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: { Authorization: lease.authorizationHeader, Accept: 'application/json' },
        signal: context.signal,
        redirect: 'error',
      });
      if (!response.ok) throw new Error(`ERP order read failed: ${response.status}`);
      return { source: 'erp', orderId, order: await response.json() };
    } finally {
      await lease.release();
    }
  };
}
```

真实适配层把原系统的无权限、未找到、过期登录、限流等转换为可识别的业务结果；示例只展示凭据、固定路由、取消与释放。远端结果按页面和工具需要筛选，凭据不进入返回值、模型上下文或日志。它运行在企业宿主，不可直接粘贴到平台受控编排中使用 `fetch`。

已发布 Runtime 的根导出还提供 `LowCodeConnector` 和 `ExecutionBinding`：前者接收 `baseUrl`、可选的认证头名称 `authorizationHeader`、超时或 transport，后者提供 `active`、`invoke(operation, signal)`、`child()`、`release()`。operation 使用 `{method, path, headers?, body?}`，返回 `{status, body}`。绑定持有实际凭据，连接器按原值写入认证头，不自动补写 Bearer 前缀；操作参数不能覆盖该认证头。它们提供传输与执行绑定，不负责把 XRain 身份自动转换为任意 ERP 身份。已有绑定由可信宿主取得并管理；`XRainRuntimeClient.fromExecution(...)` 用于 XRain API，不能据此假设任意上游地址都已授权。

## XRain 的三类 HTTP 资源

| 资源 | 职责 |
| --- | --- |
| Connector | 目标系统标识、基础地址及对应凭据绑定 |
| HttpRequest | HTTP 方法、相对路径、query、headers、body 模板 |
| HttpInterface | 对业务暴露的稳定入口、名称和执行权限；`raw` 关联请求，`orchestrated` 关联编排 |

一个连接器可供多个请求复用；请求与对外接口有独立身份。管理目录 `GET /api/integration/v1/http-interfaces/catalog` 返回实际 `invokeMethod`、`invokePath`、`permissionName`、输入变量及目标信息。引用实际权限名，不从名称拼接；变量清单也不是完整的参数类型合同。

以下按已有管理权限创建资源，调用前复用当前环境的同用途资源。路径相对 XRain，示例域名不可连接。

创建 Connector：`POST /api/integration/v1/connectors`。

```json
{
  "label": "企业 ERP",
  "name": "enterprise_erp",
  "baseAddress": "https://erp.example.invalid"
}
```

创建请求：`POST /api/integration/v1/connectors/enterprise_erp/http-requests`。

```json
{
  "label": "订单报价请求",
  "name": "erp_quote_request",
  "method": "POST",
  "path": "/v1/orders/{{input.orderId}}/quote",
  "query": {"dryRun": "{{input.dryRun}}"},
  "headers": {
    "Content-Type": "application/json",
    "Authorization": "Bearer {{credential.token}}",
    "X-Request-Id": "{{system.invocationId}}"
  },
  "body": {"amount": "{{input.amount}}"},
  "isActive": true
}
```

将返回的请求 ID 用作 `requestId`，创建 `POST /api/integration/v1/http-interfaces`：

```json
{
  "requestId": "<已创建的请求ID>",
  "label": "ERP 订单报价",
  "name": "erp_order_quote",
  "kind": "raw",
  "isActive": true
}
```

模板可读取 `input.*`、`credential.token`，以及 `system.invocationId`、`system.tenantId`、`system.actorId`、`system.timestampUtc`。整个 JSON 值为占位符时保留数字、布尔值或对象的类型；字符串内嵌替换则产生字符串。路径变量按 segment 编码，例如 `o/1001` 转为 `o%2F1001`。凭据 token 不可用于 path；在管理入口配置凭据引用，不把实际凭据写入模型包或业务参数。

网络协议、端口和可达地址由目标部署策略决定，开发时检查实际目标，不套用固定的“只能 HTTPS 443”规则。环境地址与凭据各自配置，迁移包时不要把测试地址当作生产配置。

## 调用结果与编排组合

普通运行入口是 `POST /api/integration/v1/http-interfaces/{interfaceId}`，body 直接为输入对象。例如：

```json
{"orderId": "o/1001", "dryRun": true, "amount": 1280.50}
```

其返回结构包含 `{statusCode, isSuccess, headers, body}`；外层 HTTP 200 不保证远端调用成功。读取内部状态和业务结果，保留原系统的“受理中”“未完成”等含义。raw 调试入口可能返回原始响应字节，不可与普通运行入口的封装混用。

在编排中，通过 `ctx.sdk.fn.invoke(key, input)` 调用目录中的 raw 接口名称。当前行为是远端非 2xx 导致编排调用失败；JSON 成功响应返回解析后的 body，非 JSON 响应返回状态和响应头信息。它与直接调用接口的返回封装不同，不写一套假设两者同形的解析代码。已有编排可通过 `POST /api/integration/v1/http-interfaces/from-orchestration/{orchestrationId}`，携带 `label`、`name`、可选说明与启用状态，发布成 `orchestrated` 接口。

直接调用 raw 接口检查其执行权限。通过 orchestrated 入口执行时，外层接口权限授权了该组合操作；其内部 raw 调用不要求逐一给调用者同样的接口权限，仍核对租户、启用与配置。平台记录调用继续受实际执行者的数据授权约束。设计外层接口的输入和能力时按完整业务动作授权，不把任意接口名或任意 URL 暴露成一个通用可执行参数。当前编排不能把另一个 orchestrated HTTP 接口当作 raw 子调用。

## 混合系统的查询、写入与一致性

原系统返回的记录无需先导入 XRain 才能展示。若要补充本地回访等信息，可按 `(sourceSystem, sourceTenant, sourceRecordId)` 关联。明确页面上哪些字段来自原系统、哪些可在本地编辑、哪些是某时刻的快照；外部时间、选项、金额单位和缺值由适配层映射。

多来源列表要保留各自分页或游标。只有来源支持所需筛选、排序、总数，或已有完整同步索引时，才能承诺统一分页和统计；不能把两页数据拼起来称为全量结果。平台原生关系查询和批量查询不自动跨 ERP 建立 join。管理端的 dblink 元数据浏览也不等于已提供任意外库虚拟表或跨库查询能力。

原系统写成功、本地补充保存失败时，返回这两个实际状态，使用原系统单号接续修复；不要告诉用户整个动作已回滚。外部 HTTP 调用不在 XRain 记录事务中。需要可重复执行的业务使用原系统的幂等键、业务唯一键、结果查询或项目已有补偿机制；超时后先确认原请求结果，避免重复提交。缓存、索引和快照按实际业务需要引入，附带来源与时效，不额外复制原系统全部业务规则。

验证集中在这次接入的关键行为：两个真实权限不同的测试主体能否得到对应结果、字段映射是否正确、分页是否完整表达、写入超时或部分失败能否接续。凭据续期和租户切换沿宿主已有会话机制，原系统拒绝时保留原因，不切到管理员身份绕过。

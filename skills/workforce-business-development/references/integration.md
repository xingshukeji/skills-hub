# 原系统 API、HTTP 集成与混合数据

## 选择调用方式

| 需要实现的业务 | 调用方式 | 授权由谁落实 |
| --- | --- | --- |
| 用户查询自己的 ERP 订单或提交原系统业务动作 | 企业宿主通过原系统 SDK/API，使用该系统接受的用户身份或委托凭据 | Workforce 入口检查调用资格，原系统检查该用户的数据和动作权限 |
| 企业统一访问供应商、物流等服务 | XRain Connector + 请求模板 + HTTP 接口，使用受管集成凭据 | 平台检查接口执行资格，远端按集成主体授权；业务需要的个人范围另行落实 |
| 一个动作组合平台记录与外部接口 | 平台业务编排或企业业务服务 | 各数据源保留自己的授权，组合操作还检查业务规则 |
| 只需要在现有页面增加原系统数据 | 在已有服务适配层增加调用，页面或工具共用它 | 沿用已有会话与原系统接入，不因增加展示而复制数据模型 |

用户代理须使用原系统支持的单点登录、授权、令牌交换或受信代理协议，由可信会话关联原系统身份、租户和凭据。`X-User-Id`、用户名或 XRain token 本身不构成 ERP 委托认证。

Connector 凭据按租户与连接器管理，也可用 `credentialVariableId` 绑定受保护变量；它们不是个人 OAuth 凭据。模板 `system.actorId` 可用于审计，只有远端认可相应受信协议时才表示代理用户。

变量、用户设置与 Token 见[运行配置](configuration-and-api.md)。连接器引用变量 ID，变量列表不返回秘密明文。

## 在企业宿主中转发用户请求

将原系统 API 包装为 `readErpOrder(orderId)` 等业务操作：页面和工具只提供业务参数，地址来自服务端配置，身份来自会话。保留原系统的授权、校验、版本条件和幂等约定。

宿主示例假定 ERP 已提供返回 JSON 的 `GET /v1/orders/{orderId}`。项目实现的 `acquireUserCredential` 根据可信 `context` 取得当前用户在 ERP 租户的凭据租约，返回 `authorizationHeader` 和 `release()`；用户和凭据不能由工具参数指定。

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

适配层还需映射无权限、未找到、登录过期和限流等结果，并筛选返回字段；凭据不得进入结果、模型上下文或日志。此代码运行在宿主，平台受控编排不能直接使用 `fetch`。

Runtime 根导出的 `LowCodeConnector` 接收 `baseUrl`、可选认证头名称 `authorizationHeader`、超时或 transport；`ExecutionBinding` 提供 `active`、`invoke(operation, signal)`、`child()`、`release()`。operation 为 `{method, path, headers?, body?}`，返回 `{status, body}`。可信宿主管理绑定与凭据；认证头按原值写入，不补 Bearer 前缀，也不允许操作参数覆盖。此机制不转换 ERP 身份；`XRainRuntimeClient.fromExecution(...)` 仅用于 XRain API。

## XRain 的三类 HTTP 资源

| 资源 | 职责 |
| --- | --- |
| Connector | 目标系统标识、基础地址及对应凭据绑定 |
| HttpRequest | HTTP 方法、相对路径、query、headers、body 模板 |
| HttpInterface | 对业务暴露的稳定入口、名称和执行权限；`raw` 关联请求，`orchestrated` 关联编排 |

连接器可供多个请求复用，请求与接口身份独立。`GET /api/integration/v1/http-interfaces/catalog` 返回 `invokeMethod`、`invokePath`、`permissionName`、输入变量与目标信息。使用返回的权限名；变量清单不等于完整参数类型合同。

先复用同用途资源；确需创建时使用管理权限。以下路径相对 XRain，示例域名不可连接。

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

模板支持 `input.*`、`credential.token`、`system.invocationId`、`system.tenantId`、`system.actorId`、`system.timestampUtc`。整个 JSON 值为占位符时保留类型，字符串内嵌替换产生字符串。路径变量按 segment 编码，如 `o/1001` → `o%2F1001`。token 不可用于 path；凭据在管理入口绑定，不写入包或业务参数。

协议、端口和可达地址按部署策略检查，不套用固定 HTTPS 443 限制；环境地址与凭据分别配置，迁移时替换测试地址。

## 调用结果与编排组合

普通入口 `POST /api/integration/v1/http-interfaces/{interfaceId}` 的 body 直接为输入对象：

```json
{"orderId": "o/1001", "dryRun": true, "amount": 1280.50}
```

返回 `{statusCode, isSuccess, headers, body}`；按内部状态和业务结果判断，HTTP 200 不保证远端成功。raw 调试入口可能返回原始字节，不能套用此封装。

编排通过 `ctx.sdk.fn.invoke(key, input)` 调用目录中的 raw 接口名称：远端非 2xx 导致调用失败；JSON 成功响应返回解析后的 body，非 JSON 返回状态和响应头，与直接调用不同。已有编排可用 `POST /api/integration/v1/http-interfaces/from-orchestration/{orchestrationId}`，携带 `label`、`name`、可选说明和启用状态，发布为 `orchestrated` 接口。

直接 raw 调用检查其执行权限；orchestrated 入口按完整组合动作授权，内部 raw 调用不逐项要求调用者拥有同样权限，但仍检查租户、启用和配置。记录操作仍受执行者的数据授权约束。外层参数不得开放任意接口名或 URL；编排也不能将另一个 orchestrated HTTP 接口作为 raw 子调用。

## 混合系统的查询、写入与一致性

原系统记录可直接展示，本地补充信息按 `(sourceSystem, sourceTenant, sourceRecordId)` 关联。页面区分来源、可编辑字段和快照；适配层映射外部时间、选项、金额单位及缺值。

多来源保留各自分页或游标；统一分页和统计须有来源支持的筛选、排序、总数或完整同步索引。原生关系/批量查询不跨 ERP join；dblink 元数据浏览也不等于外库虚拟表或跨库查询。

外部 HTTP 不在 XRain 记录事务内。远端成功、本地失败时返回各自状态，用远端单号接续修复；重试使用幂等键、业务唯一键、结果查询或既有补偿，超时先确认原请求结果。缓存、索引和快照按需引入，记录来源与时效。

验证不同权限主体、字段映射、分页、超时和部分失败恢复。续期与租户切换沿宿主会话机制；保留原系统拒绝原因，不改用管理员绕过。

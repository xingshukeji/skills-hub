# 运行配置与 API 访问

用于变量、偏好和外部程序访问 XRain；原系统接入见[系统集成](integration.md)。

## 把配置放在合适的位置

| 内容 | 承载方式 |
| --- | --- |
| 需查询授权的业务事实 | 对象及字段；阈值按用途判断是数据还是配置 |
| 列表密度、默认视图 | 当前租户用户设置，由页面读取 |
| 默认语言、业务时区 | 平台地区设置 |
| 连接器受保护值 | 平台变量或专用凭据入口，由受管资源消费 |
| 外部程序调用凭据 | 绑定主体与租户的 API Token |
| 企业宿主参数 | 项目已有配置/秘密管理 |

配置须有明确名称、格式、默认值和读取者；变量不自动注入所有编排或进程。

## 平台变量

`GET /api/variables/items` 返回 `{id, tenantId, variableKey, keyVersion, hasValue}` 数组，不返回明文值。`PUT /api/variables/items` 接收 `{variableKey, value}`，成功无内容。变量值是字符串，其内部是否为 JSON 由实际消费者规定。

key 长度 2–128，以小写字母开头，其余为小写字母、数字、点、下划线或连字符。sys.* 仅允许更新已登记项；自建 key 如 service.erp.credentials。

租户入口要求当前租户管理资格与变量准入；Host 管理入口可另选作用域。表单显示 hasValue，未修改则不 PUT：缺省/null value 会写成空字符串。占位符不是密码，keyVersion 不是 ETag。

Connector 的 credentialVariableId 绑定本作用域变量 ID，不是 key。明文留在受管入口，按绑定、hasValue 和调用结果验证；变量值与安装绑定分别配置，均不自动授予接口执行权。

## 当前用户设置

`GET/PUT /api/tenant/v1/settings/{settingApp}/{key}` 仅操作当前租户用户，不接收 userId。已配置 GET 返回 `{settingApp, key, value}`，未配置为 404 空正文；PUT `{value: string}` 替换整个字符串。

例如给业务应用保存列表偏好：

```json
{"value":"{\"density\":\"compact\",\"defaultView\":\"myOpenRequests\"}"}
```

应用解析 value 并提供默认值；普通设置不承诺属性合并或 ETag，可按独立更新需要拆 key。它不保存秘密或授权事实。特殊键 xrain/regionalPreferences 采用属性合并，见[时间上下文](regional-context.md)；切换租户后重新读取。

## 外部程序调用 XRain

API 访问要分别核对认证方式、接口准入和实际业务授权：

| 层次 | 开发时如何消费 |
| --- | --- |
| 接口目录 | `/api/service/authen/v1/security/tenant-api-catalog?catalog=external` 返回登记的对外 API；internal/directory 与 `format=openapi` 按目标实际支持情况使用 |
| 认证方式 | 读取条目的 `admission`：`TenantApiToken`、`TenantLogin`、`HostLogin`、`Anonymous` 是不同入口要求 |
| 接口调用资格 | 使用实际 `requiredPermission`、`requiredRole`、`callableInCurrentSession/unavailableReason` 及响应中的其他准入条件；目录不是授权引擎 |
| 执行身份 | Token 的 `subjectUserId` 是调用主体；签发人的 `createdById` 不会替代它 |
| 业务结果 | 对象、字段、记录范围、应用和业务状态继续独立检查 |

管理目录权限与业务调用权限分别处理。目录不覆盖所有模块，可调用提示不替代授权响应；已知目录/OpenAPI 错误见[实测范围](api-verification.md)，业务入口见[API 索引](business-api.md)。

当前 API Token 管理基址为 `/api/service/authen/v1/security`：

| 请求 | 合同与用途 |
| --- | --- |
| `GET /api-token-subjects` | 查询可签发的本租户有效主体；条目使用 `subjectUserId/userName/name` |
| `GET /api-tokens` | 分页列表，含主体、签发人、有效状态、创建/过期/撤销时间；不含 token 明文 |
| `POST /api-tokens` | `{subjectUserId, expiresAtUtc}`；由有资格的租户管理员签发 |
| `POST /api-tokens/{tokenId}/reveal` | 显式读取仍有效凭据，返回 `apiToken`，用于已授权的配置或复制 |
| `POST /api-tokens/{tokenId}/revoke` | 撤销该凭据 |

签发返回 api_token，reveal 返回 apiToken；创建不接受任意 scopes。Token 固定绑定租户与 subjectUserId，按该主体授权，不能代替仅接受登录态的入口。凭据由服务端保存，不进入 URL、日志、工具参数或浏览器持久化。

授权范围内轮换时，签发替代凭据、更新消费者并验证，再撤销旧凭据。失败分别检查有效期、成员状态、接口准入和数据权限，复用固定身份。

API 中心调试为 `POST /api/service/authen/v1/security/api-debug`，body `{catalogKey, tokenId, input}`；按登记目录和所选 Token 真实执行，包括其写入/投递副作用，不支持任意 URL 或临时认证头。

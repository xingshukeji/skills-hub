# 运行配置与 API 访问

用于环境参数、凭据绑定、个人偏好，以及让外部程序调用 XRain。已有系统的请求模板和用户身份转接见[系统集成](integration.md)。

## 把配置放在合适的位置

| 内容 | 适合的承载方式 | 消费方 |
| --- | --- | --- |
| 申请金额、客户地区、业务阈值等需查询授权的事实 | 业务对象及字段；按业务决定阈值是否为数据或应用配置 | 记录 API 与业务操作 |
| 用户列表密度、默认视图等个人偏好 | 当前租户用户设置 | 对应业务页面主动读取 |
| 租户默认语言与业务时区 | 平台地区默认设置 | 时间上下文、页面及调度 |
| 连接器等受支持资源使用的受保护值 | 平台变量或该资源的专用凭据入口 | 平台受管消费者 |
| 外部程序访问 XRain 的凭据 | 绑定租户和调用主体的 API Token | 外部程序按接口准入调用 |
| 企业宿主自身的部署参数 | 项目已有配置与秘密管理方式 | 企业宿主 |

创建一项设置不会自动修改页面，创建一个变量也不会自动注入所有编排或进程。配置名称、值格式、默认值和实际读取者应在业务实现中一致；使用已有的消费者协议，缺少通用变量读取接口时不自行拼造一个。

## 平台变量

`GET /api/variables/items` 返回 `{id, tenantId, variableKey, keyVersion, hasValue}` 数组，不返回明文值。`PUT /api/variables/items` 接收 `{variableKey, value}`，成功无内容。变量值是字符串，其内部是否为 JSON 由实际消费者规定。

变量 key 长度为 2–128，以小写字母开始，其余只使用小写字母、数字、点、下划线或连字符；`sys.*` 为系统保留，管理端只能更新已登记的系统变量，不能自行创建任意 sys 名称。自建用途可使用类似 `service.erp.credentials` 的稳定名字。

租户入口从当前身份确定作用域；当前实现还要求租户管理员及变量管理准入，不能传入别的 tenantId 切换范围。Host 管理员入口可显式选择 Host 或租户作用域，这是平台管理职责，不是普通业务页面权限。

凭据编辑表单显示 `hasValue`，允许用户显式替换，不把占位符提交为新密码。该 PUT 的缺省/null value 会成为空字符串，不能作为“保留原值”的写法；没有修改时不发送更新。`keyVersion` 不是这个接口提供的 ETag 或条件更新令牌。

受管 Connector 可以通过 `credentialVariableId` 绑定变量 ID；ID 从本作用域变量列表选取，不把变量 key 当 ID，也不把明文放进包资源、工具参数或前端状态持久化。安装后的环境绑定与变量值配置分别处理。验证应看绑定对象、hasValue 和受管调用结果，不以“回读不到明文”判定保存失败。

例如多个维修集成请求使用同一 ERP 连接器：只维护该连接器实际引用的变量；切换环境时配置目标环境的变量和绑定，沿用请求模板的业务参数。变量本身不授予任何人调用 ERP 接口的能力。

## 当前用户设置

`GET/PUT /api/tenant/v1/settings/{settingApp}/{key}` 只操作当前租户、当前调用者的 USER 设置，不接收目标 userId。GET 已配置时返回 `{settingApp, key, value}`；实测未配置时为 HTTP 404 **空正文**，不能无条件调用 JSON 解析或从错误体读取 value。PUT body 是 `{value: string}`，普通设置替换整个字符串值。

例如给业务应用保存列表偏好：

```json
{"value":"{\"density\":\"compact\",\"defaultView\":\"myOpenRequests\"}"}
```

页面读取后按本应用定义解析 value，缺省时使用自己的默认值。两个页面同时修改同一普通设置时，不能假定它提供属性级合并或 ETag；需要独立更新的偏好可拆分稳定 key。个人设置不是秘密存储，也不能通过写一个角色名改变授权。

`xrain/regionalPreferences` 是平台的特殊设置键，采用属性合并而非普通整值替换，具体见[国际化与时间上下文](regional-context.md)。同一人在不同租户有独立设置，租户切换后重新读取。

## 外部程序调用 XRain

API 访问要分别核对认证方式、接口准入和实际业务授权：

| 层次 | 开发时如何消费 |
| --- | --- |
| 接口目录 | `/api/service/authen/v1/security/tenant-api-catalog?catalog=external` 返回登记的对外 API；internal/directory 与 `format=openapi` 按目标实际支持情况使用 |
| 认证方式 | 读取条目的 `admission`：`TenantApiToken`、`TenantLogin`、`HostLogin`、`Anonymous` 是不同入口要求 |
| 接口调用资格 | 使用实际 `requiredPermission`、`requiredRole`、`callableInCurrentSession/unavailableReason` 及响应中的其他准入条件；目录不是授权引擎 |
| 执行身份 | Token 的 `subjectUserId` 是调用主体；签发人的 `createdById` 不会替代它 |
| 业务结果 | 对象、字段、记录范围、应用和业务状态继续独立检查 |

租户目录与凭据管理使用相应管理身份；把接口信息用于开发后，普通业务调用不需要先取得管理员目录权限。目录条目的可调用提示也不能代替真实响应，更不能证明有权读取所有记录。

2026-10-23 测试目标的 external/internal JSON 目录分别返回 31/35 项，`catalog=directory` 和 `catalog=external&format=openapi` 均返回 500。开发可继续使用成功返回的 JSON 目录及[业务 API 索引](business-api.md)；不能据此宣称 OpenAPI 已验证可用，也不能把目录项数视作平台全部业务接口数。编排、集成、个人邮箱等还有各自的登录态与能力入口。

当前 API Token 管理基址为 `/api/service/authen/v1/security`：

| 请求 | 合同与用途 |
| --- | --- |
| `GET /api-token-subjects` | 查询可签发的本租户有效主体；条目使用 `subjectUserId/userName/name` |
| `GET /api-tokens` | 分页列表，含主体、签发人、有效状态、创建/过期/撤销时间；不含 token 明文 |
| `POST /api-tokens` | `{subjectUserId, expiresAtUtc}`；由有资格的租户管理员签发 |
| `POST /api-tokens/{tokenId}/reveal` | 显式读取仍有效凭据，返回 `apiToken`，用于已授权的配置或复制 |
| `POST /api-tokens/{tokenId}/revoke` | 撤销该凭据 |

签发响应中的秘密字段名是 `api_token`，与 reveal 的 `apiToken` 不同。创建合同没有任意 scopes 数组；Token 不自动成为一套独立权限，调用者权限由实际主体在本租户的授权决定。权限不足时调整已确认的业务授权，不假造 token scope，也不默认换成全权管理员。

Token 固定绑定租户。请求的 tenantId、用户名或页面选择不能替代其认证主体；接口只接受登录态时，不能因为已有 Token 就假设也可调用。外部程序按目标公开的认证头方式或已有连接封装使用 Token，企业宿主在服务端保存，不把它放入 URL、日志、工具参数或浏览器持久化配置。

凭据轮换可沿受管入口签发替代凭据、更新实际消费者并核对其调用，再撤销旧凭据；这些动作应符合本次账号和凭据维护范围。请求失败要区分过期/撤销、成员停用、接口准入和记录授权；不要为不同角色或每轮验证重复建身份。

API 中心的单次调试使用 `POST /api/service/authen/v1/security/api-debug`，body 为 `{catalogKey, tokenId, input}`。它按已登记目录和所选 Token 执行，不支持任意 URL、临时认证头或伪造执行者；这是实际调用，若对应接口会写数据或投递消息，调试也有相同行为。

例如仓储程序只需读取可见的维修备件申请，应使用其已定义用途的主体，授予对应接口及对象/字段/记录范围。接通查询只说明读取链路可用，不据此开放申请关闭、Owner 转移或应用安装。

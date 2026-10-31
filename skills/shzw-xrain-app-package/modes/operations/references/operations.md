# 目标安装与恢复

本文件是 authoring 构建完成后与 operations 消费原包共用的安装合同。安装不要求作者源码、平台私有源码或 .NET SDK；已有 operation 时直接读取原记录和当前 installation 接续，不重新获取或构建原包。

## 按交付来源进入

先核对目标平台、租户、packageId、versionId、来源与包内 digest；显示名不作身份。有本地原包时再核对文件 SHA-256。三条路径最终都使用目标租户会话安装和回读：

| 当前交付 | 安装前动作 | 必要身份与完整性证据 |
|---|---|---|
| 精确版本已在目标目录 | GET packages/versions 核对该版本、digest、来源及当前安装；直接进入预检/安装，不重复导入 | 目标 tenant-scope 管理会话；不索要 Host 会话、原包文件或构建环境 |
| 用户选定市场中的明确版本，目标尚未导入 | 平台 GET `/api/application/v1/exchange` 核对所用市场，再 POST `/api/application/v1/exchange/packages/{packageId}/versions/{versionId}:import`；导入后重新读取目标版本 | 目标 tenant-scope 管理会话；比对选定市场版本与目标回执的身份/digest；无需本地文件、Host 会话或作者源码 |
| 交付的是本地 `.appkg` 原包，目标尚未导入 | 按交付清单核对来源、身份、包内 digest 与文件 SHA-256；经获准入口将原二进制 POST `/api/application/v1/packages:import`，再用 tenant 会话读取版本 | 本次获准的 Host-scope sysadmin 导入会话与目标 tenant 管理会话分别使用；服务端读取器校验容器、内容及 digest，回执须与交付清单一致 |

本地原包用已有文件摘要工具核对 SHA-256；已有离线校验工具可继续使用，但不为安装追加 SDK 或重建包。缺来源、身份或完整性资料时向交付方核实，只阻断依赖缺项的动作，不用重新压缩 ZIP、改摘要或同版本新包代替原制品。导入本身是远端写入，仍须在本次授权内，不能当连通性测试；导入成功也不等于租户已安装。

市场 GET `/api/exchange/v1/packages` 供浏览，不代替平台实际配置的市场与安装准入。`capabilities` 只是当前身份能力提示，`catalog-bootstrap` 的 `unavailable:true` 表示版本读取失败，不能当空目录。

## 准入

这是应用包导入/租户安装，不是 XRain 服务镜像部署；不构建容器、不执行 SQL、不重启服务、不写数据库、不创建租户或账号。先确认目标现有 XRain 实现支持本包使用的 kind 和应用安装 API、迁移已由目标运维完成。支持该接口的目标可用 `GET /api/application/v1/capabilities` 查看当前身份的安装、提交、审查、发布和创建应用能力；旧目标可能未提供。它不证明当前身份可操作特定包，也不证明该包的 kind、协议或业务流程可用，仍须核对实际版本与预检。生产需要目标版本发布准入和相同包的测试证据，不能因路由存在就认定支持。

目标参数与 `.appkg` 分开：

```json
{
  "environment": "development",
  "baseUrl": "https://xrain.example.invalid",
  "tenantId": "目标已有租户ID",
  "tenantTokenEnv": "XRAIN_TENANT_TOKEN",
  "packageId": "apg00000000000000001",
  "versionId": "apv00000000000000001",
  "expectedDigest": "包内digest"
}
```

environment 只允许 development/test/production；不从端口或域名猜环境。baseUrl 从已授权目标及其配置确定，使用实际配置的 HTTP 或 HTTPS 入口，不自行改写协议或端口。示例域名不可实际调用。读取已有安全会话或仅从指定环境变量取短期凭据；不要打印、保存或要求在聊天粘贴 token，不伪造 JWT。解码 JWT 声明不是验证凭据；以目标认证结果和租户访问结果为准。

本地原包路径才另提供 `packageFile`、`expectedFileSha256` 与安全 Host 会话引用（如 `hostTokenEnv`）；Host 导入需要 Host-scope sysadmin。租户目录、市场导入、版本、安装、operation 使用目标 tenant-scope 管理会话，安装要求 `platform.application.manage`，默认租户管理员拥有。两身份不要混用；tenantId 由认证 session 决定，禁止自造 tenant header 或把 tenantId 写入 install body。已有配置与登录可用时自行使用，无需用户再提供数据库连接。

这里的会话必须通过正式登录取得 JWT。XRain API Token（包括 CLI 中名字叫 admin 的别名）不支持 application 管理路由；能读元数据不证明它能安装。401 `authentication_method_not_allowed` 应更换为已获授权的登录会话，不能升级角色、重复导入或放宽服务端准入。登录态与 tenant 身份以目标认证结果为准。

对测试或生产等命名共享目标，实际写入前固定：当前用户授权、目标/租户、所选渠道的来源与包内 digest，持本地原包时再记录文件 SHA-256，以及准入证据、绑定变更、影响、恢复责任人及入口。记录不含秘密的安装计划及 operationId，以便跨会话恢复；如果所在项目有正式审批/部署中心，使用其入口，不绕过。可独立项目使用本节同等内容即可，不依赖某个特定仓库的文件路径。缺少生产准入或用户授权时仅交付现有制品资料和待执行请求。

## HTTP 合同

拼接 baseUrl 与以下绝对 API path（baseUrl 是服务 origin，不自带 /api）。JSON 属性为 lowerCamelCase。使用合法 Bearer 会话。先按当前 HTTP schema 核对枚举序列化；下面 resolve 用该 DTO 默认数字值，避免假设全局 string-enum converter。

| 请求 | 请求内容/意义 |
|---|---|
| GET `/api/application/v1/exchange` | 目标平台实际使用的市场。 |
| POST `/api/application/v1/exchange/packages/{packageId}/versions/{versionId}:import` | 目标租户管理会话导入市场指定版本；不是 Host 本地原包上传，不安装或发布。 |
| POST `/api/application/v1/packages:import` | Host 身份；Content-Type: application/octet-stream；body 为 `.appkg` 原始二进制，不是 multipart、base64 或 JSON。会写 Host 目录，不是 dry-run。 |
| GET `/api/application/v1/packages` | 租户身份；数组包含 id/namespace/label/versionCount/installedVersionId/installationId/revision。 |
| GET `/api/application/v1/packages/{packageId}/versions` | 返回 id/packageId/version/digest/recordCount 等；用 package+versionId+digest 校验导入结果。 |
| GET `/api/application/v1/packages/{packageId}/versions/{versionId}/components` | 返回 recordId/kind/name 摘要，供安装前审阅；不返回源码、模板、种子或绑定。旧目标可能尚未提供，不能把 404 当包无组件。 |
| POST `/api/application/v1/packages/{packageId}/install` | `{versionId,expectedRevision,tenantBindings,confirmations,requestId,maintainInstalledVersion?}`；初装、升级、重装同入口。初装未有 installation 时 expectedRevision 可 null；已有安装必须使用最新 revision。仅维护当前已安装版本的租户绑定时设 `maintainInstalledVersion=true`，并显式提供当前 `versionId`、`expectedRevision` 与 `tenantBindings`。requestId 是客户端预先保存的稳定 operation ID。 |
| GET `/api/application/v1/installations/{installationId}` | id/tenantId/packageId/installedVersionId/revision/activeOperationId；校验真实目标身份。 |
| GET `/api/application/v1/operations/{operationId}` | id/installationId/sourceVersionId/targetVersionId/sourceRevision/status/errorCode/details。 |
| POST `/api/application/v1/operations/{operationId}/resolve` | `{expectedRevision,resolutions,tenantBindings,confirmations,configurationChanges}`；配置修改使用下述 presence 信封，不能用通用属性选择覆盖包定义。 |
| POST `/api/application/v1/operations/{operationId}/continue` | 无新参数；仅继续 Running/Finalizing 原冻结计划，成功重放返回原结果。 |
| POST `/api/application/v1/operations/{operationId}/retry` | 可选 `{requestId,expectedRevision}`；仅 Failed，重新 preflight，可能返回新 operationId。 |
| POST `/api/application/v1/operations/{operationId}/cancel` | 无 JSON body；仅 Pending/Waiting 可取消。 |
| DELETE `/api/application/v1/installations/{installationId}` | `{requestId,expectedRevision}`；创建卸载 operation，不删表/数据；必须另有用户授权，不用于自动失败回滚。 |
| PATCH `/api/application/v1/packages/{packageId}` | Host 身份，`{label}`；只改目录标签，不改已导入版本。非安装必要步骤。 |

导入成功结果：`packageId,versionId,namespace,version,digest,recordCount,alreadyExisted`。必须与所选市场版本或本地原包交付清单一致；alreadyExisted 只代表相同版本幂等，不代表已安装。

已提供 `shzw-xrain-cli` 时先读其入口并核对实际平台身份。目录和版本使用 app list/versions，市场指定版导入用 app import，预检/提交用 app preview/install；app status 仍只查发布状态。app import 没有本地 Host 原包上传能力；本地文件按上面的原二进制 HTTP 合同和原管理入口导入，不编造 CLI 上传参数。安装自带服务端预检，需要先审阅影响时才另调 preview。

原操作使用 app operation show/wait/resolve/continue/retry/cancel；等待只查询，不自动恢复。CLI 提交前打印 requestId，结果未知先按该 ID 查询。`--json` 的读取结果在 data，写入或等待失败时的最近回执在 error.details.operation；回执工具输入须取出原对象。具体选项查对应命令 `--help`。

requestId 使用 20 位 ASCII 字母数字且以 apo 开头；每次新的逻辑提交生成新 ID，重试 Failed 创建新操作时不能复用旧 operationId。安装、卸载、resolve/retry/cancel 返回 operation，不以 HTTP 200 判安装成功。错误包含 status/errorCode/message/operationId；对外只保留去秘密摘要。

## 安装顺序

预检读取 ready、requiredBindings、requiredConfirmations、conflicts、changes 及源/目标版本，不只看 HTTP 状态。提交后保存 operation 的 id/installationId/sourceRevision/status；响应未知时结合原 requestId、activeOperationId/latestOperationId 与分页历史核对，不跟错他人的最新操作。

1. 按交付来源核对身份与摘要。只读目标目录，保存已有 installation 的版本/revision/活动操作。已有活动操作先跟踪，不重复创建；已导入版本不再次导入。
2. 目标尚无该版本时，仅按选定的市场或本地原包路径导入；随后用目标 tenant 身份重新 GET versions 核对身份和 digest。原包文件及其 SHA-256 保持不变。
3. 根据资源生成 tenantBindings，确认账户/主体来自目标 tenant，提交 install。首次返回 operation 后立即安全保存 operationId/installationId/目标/digest，不保存 token。
4. 以适度退避 GET operation（例如 2、5、10 秒，之后最多 30 秒），不自动重复 POST。超出本次等待窗口交付可恢复 operationId；没有后台监控授权时不创建持续任务或声称会自动继续。
5. Waiting 时展示实际 requiredBindings/requiredConfirmations/conflicts；补齐后核对 sourceRevision 与当前 revision，按授权 resolve。冲突键是 `recordId/unit`；只有删除单元 `$delete` 使用数字选择：2 表示按版本移除，3 表示保留（仅对象、字段、视图、选项集、选项、记录类型）。旧枚举 0/1 不再用于 I/P 属性；不能批量选择或伪造确认 token。`$configuration` 使用 configurationChanges，其他身份或包控冲突需兼容版本或取消。
6. Succeeded 后 GET installation，核对 tenantId/packageId/installedVersionId=operation.targetVersionId、revision=operation.sourceRevision+1，activeOperationId 为空；按用户授权进行一个最小只读功能检查，并确认后续登录/self 仍可用。只有这些成立才报告安装成功。业务权限集定义、目标主体绑定与实际业务 API 可访问是不同证据；导入 PermissionSetItem 不等于已赋权。

回查历史成功时，当前 revision 可能已因同版本配置维护、隐藏视图恢复或其他安装操作增加；读取后续操作历史，不把旧 Succeeded 改判为失败，也不拿它证明当前目标已完成。当前提交事实、组件有效状态与原用户业务验收分别报告；回执辅助核对见[本地工具](receipt.md)。

网络超时/响应丢失：先 GET 预先保存的 requestId/已知 operation；不知道 ID 时 GET packages 找 installationId，再 GET installation 读取 activeOperationId/latestOperationId。支持 requestId 的目标可用同一 ID 和完全相同请求重试提交，首次接受的请求决定写集；禁止换 ID 或修改同一请求的内容。旧目标不能确认结果时保持未知，交目标维护者核对。目录本身不返回 activeOperationId。版本不存在、401/403、schema/digest 错误与不支持的 kind 停止；不扩大权限或修改服务器来“安装成功”。

Waiting 必须包含可操作的绑定、冲突或确认。若返回 BindingRequired 却 requiredBindings 为空，或同一合法 resolve 长期无进展，应记录 operationId、状态、修订和错误码，交服务端维护者调查；不凭猜测反复提交。修复服务端故障属于独立的源码修复授权，普通安装 skill 不直接改库或部署服务。

## tenantBindings

### 安装管理查询（需要目标已实现）

| 路由 | 用途与限制 |
|---|---|
| `POST /api/application/v1/packages/{packageId}/preview` | 使用 install 请求形状；只读引用、绑定、合并及物理结构预检，不创建 installation/operation。返回当前 revision、缺失绑定、冲突单元和影响摘要；不返回冻结 plan，提交仍重新校验。404 不证明包损坏，先核实目标版本是否提供该接口。 |
| `GET /api/application/v1/installations/{id}/components` | 当前租户有效组件摘要，区分 Package、Overridden、Hidden、Retained、Local；核对 effective/state/baseVersionId/changedProperties。binding 仅含允许的字段，凭据只引用 ID。包原始清单不能代替它。 |
| `GET /api/application/v1/installations/{id}/operations?page=1&pageSize=20` | 当前 installation 的分页操作历史；不要将历史 Succeeded 作为本次操作成功，也不要为查看历史调用 retry。 |
| `POST /api/application/v1/installations/{id}/check` | scope 仅 CurrentActorObjectReadOnly；当前登录身份的对象只读检查，刷新该应用就绪缓存后经正常查询授权读取并丢弃业务数据。返回检查身份、时间及修订；非对象资源为 NotChecked，不代表成员流程或外部服务验证通过。 |

账户和凭据等安装配置调整复用同一已安装 version 的 install，携带读取绑定时的 expectedRevision，且只提交编辑字段。目标支持已安装版本维护协议时设置 `maintainInstalledVersion=true`；即使该版本不再发布，也只允许维护当前 installation，不能用此标记初装、重装或切换到旧版本。目标尚不支持该协议时不得假定可维护未发布版本。不要直接写 binding 表，也不要将原始包 values 作为绑定提交。当前管理员不得通过模拟其他 userId、扩大权限或替换成员 token 来制造普通用户验收结果。

install/resolve 的 `tenantBindings` 是平铺字典：`{"recordId/name": 值}`。每个键由包记录 ID、一个 `/` 和该 kind 允许的绑定名组成；同一记录的多个绑定分别提交。不要使用 `{recordId:{绑定键:值}}`，也不要发送持久化 binding 的 overrides/values/tenantBindings 内部结构。

```json
{
  "versionId": "apv00000000000000001",
  "expectedRevision": 0,
  "tenantBindings": {
    "01y00000000000000001/accountId": "目标现有邮箱账户ID"
  },
  "confirmations": []
}
```

这些示例记录必须存在于目标包版本或当前安装 binding 中，身份须来自目标租户；示例本身不是有效环境资料，不能把假 ID 上传试错。`ownerId/accountId/credentialVariableId` 是非空字符串。省略键保留当前值，不能用 null 清空标量配置。角色/用户授权和共享规则编辑使用系统标准管理 API，不得通过 install/resolve 提交。

绑定键来自原响应并保留大小写；BizConnector/baseAddress 属于连接器记录，不属于引用它的 BizHttpRequest。原 Waiting 操作已有选择时，可用[请求生成器](receipt.md#生成原操作的-resolve-请求)准备已决定的绑定/配置/确认，状态变化后重新读取，不发旧文件。

绑定键缺少 `/`、使用多个 `/`、记录不存在、绑定名不属于该 kind 或值类型错误时，服务器返回 400 `application_package_invalid`。若错误响应的 `operationId` 为 null，则没有可据此 resolve/retry 的 operation；先只读核对已有安装和活动操作，再修正 install 请求中的绑定。不得重打包、重导入或改变已冻结 versionId/digest 来修正绑定形状。

| kind | 唯一允许的绑定键 |
|---|---|
| BizListView、RoutineTemplate、RuntimeRecord | 初装 ownerId；视图默认安装者，Routine/种子需合法 Owner。之后通过标准 owner 管理，不借升级改 Owner。 |
| BizConnector | 远程连接 credentialVariableId/baseAddress；远程请求用 `{{credential.token}}` 才要求凭据，本地 connector 禁止。 |
| InfraEmailTemplate | accountId，必填。 |
| InfraSmsAliyunTemplateBinding | accountId 必填；providerTemplateCode/signName 可调整实际绑定初值。 |
| 其余 | 无；Feishu 使用租户既有唯一账户，不添加 accountId。 |

确认对象为 `{recordId,unit,token}`，全部复制自当前 operation.requiredConfirmations，并先取得对应影响确认。主体、凭据变量、账户必须同 tenant、有效、未删除且调用者有权使用；缺少时报告，不创建替代账户/用户或把角色名当 ID。

## 候选配置、来源与旧安装转换

`configurationChanges` 是 `recordId/property` 到 presence 信封的平铺字典：`{"view-id/conditions":{"present":true,"value":[]},"view-id/helpText":{"present":false}}`。`present:true` 必须包含 value（可为合法 null）；`present:false` 不得包含 value，表示缺失而非 null。仅提交冲突返回的 editableProperties 中实际修改的 T 属性；服务端仍校验嵌套合同、引用和权限。安装输入 tenantBindings 不替代该协议。使用包默认值也应逐属性生成相同信封，不提交 UsePackage 枚举，不修改全局版本。

`$configuration` 的 tenantValue 是待安装有效值，packageValue 是目标包默认值。视图、记录类型、Routine 的原编辑器分别需要 editorContext.fields、recordTypeFields、inputModel.fields；没有上下文时不能改用当前安装的字段/输入模型冒充候选。可按授权采用包默认配置并重新预检，或取消。失败保留草稿，租户、安装版本或 revision 变化后重新核对，不能套用旧确认。

组件与标准资源接口的 management 返回 origin/state/package/policyVersion/revision、allowedActions、editableProperties、restrictions。只执行服务端允许的动作；来源缺失或冲突不能按本地资源处理。数据访问权限与定义修改能力相互独立；包对象中的本地字段仍归租户。只有包视图可隐藏，恢复使用 `POST /api/application/v1/installations/{id}/components/{recordId}:restore` 与 `{expectedRevision}`，重新检查当前版本与引用。

installation.managementPolicyVersion=0 表示来源控制待核对，普通定义修改、升级和旧属性 resolve 被阻断；业务数据仍按原权限工作。不得通过启动、重装或直接改 binding 自动转换：

1. `POST /api/application/v1/installations/{id}/policy:preview` 无请求体，只读返回 expectedRevision、currentPolicyVersion、targetPolicyVersion、status、differences、requiredBindings、requiredConfirmations、configurationConflicts。Blocked 或任一差异 canRestorePackage=false 时调查来源/数据兼容，不能强制恢复。
2. 明确审阅需恢复的旧包控属性与非法隐藏后，提交 `POST /api/application/v1/installations/{id}/policy:apply`：`{targetPolicyVersion,expectedRevision,restorePackageProperties:[{recordId,property}],tenantBindings,configurationChanges,confirmations,requestId}`。属性名逐项来自 preview，不猜测或批量接受未知差异。转换仍要求当前应用及命中资源管理权限，不能修改实际实例目标。
3. 保存并跟踪返回 operation；版本保持不变。成功后核对同租户/安装、revision=sourceRevision+1、managementPolicyVersion=targetPolicyVersion、activeOperationId 为空。Pending/Waiting/Failed 走原操作恢复入口，不另建并行转换；响应未知只用同一请求身份核对。转换保留 T 的缺失/null、实际 Routine/SMS 配置和旧 seed 初始化记录，不重写业务数据或恢复已撤销授权。

## 状态与恢复

| status | 行动 |
|---|---|
| Pending | 可能等待在途执行；继续观察或按明确授权 cancel，不终止业务任务。 |
| WaitingForResolution | 无法完成绑定/冲突/数据确认；保留旧有效版本，提交已授权 resolve 或 cancel。 |
| Running | 本地准备中，本应用不可用；提交可能已经完成，错误时保留原 operation，处理原因后 continue，不能 cancel/retry/改表。 |
| Finalizing | 准备已提交，正在使版本生效并失效缓存；中断后 continue 同一操作，结果未明时保持门禁。 |
| Succeeded | 核对 installation 才算安装成功。 |
| Failed | 尚未开始准备，或首次本地准备已确认回滚，版本和数据未生效；修复原因后按授权 retry，重新预检。 |
| Cancelled | 未完成安装，不是成功。 |

没有 WaitingForBindings 状态。Failed 返回 `requiresResubmission:true` 或 `application_operation_resubmission_required` 时，恢复原变更输入并重读 revision/影响后再提交，不能反复 retry。普通 Running/Finalizing 先观察；只有确认执行中断且原授权覆盖恢复时才 continue。

`application_change_in_progress` / 活动 operation 冲突返回 409：跟踪已有操作。`application_revision_conflict`：重读、丢弃旧确认、重新审查。`application_version_immutable_conflict`：核对制品，不能改 digest 绕过。`application_recovery_mismatch`：保留 operation 门禁与现场交运维，不写补偿 SQL。

卸载只清版本可见性、暂停 Routine，保留结构、种子、绑定和历史，不等于数据回滚。装旧 SemVer 仍须数据兼容性检查；不得把“重装旧包”当无需批准的回滚。失败时报告精确状态与恢复入口，不自动卸载或删除数据库。

包内普通权限集不会自动授权角色或用户。声明为 `assignmentAudience=allEmployees` 的权限集会在预检中展示当前及未来员工的安全影响；只有确认通过且提交后的 `allEmployeesEnabled=true` 才生效，租户可在已安装组件配置中撤销。具体角色/用户仍通过系统标准管理分配，共享规则的适用角色由标准管理维护；不提交旧角色/用户数组，也不以升级或重装恢复已撤销的全员开关。

安装提交须通过目标服务端预检；需要提前审阅影响时单独调用 preview，不因提交而重复一次相同检查。包中标准权限声明会在导入落库前拒绝；安装采用本地事务、分阶段准备和受控生效，不要求开启 prepared transaction。执行前说明本应用暂不可用、开始后不可取消、已提交准备保留，中断后继续原操作。不要用卸载、换版本或直接删除表代替恢复。旧执行模型的活动操作不自动转换，须沿受管恢复入口处理。

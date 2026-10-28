# 包编写契约

## 文件、身份与版本

`.appkg` 是 ZIP，仅有 `manifest.json` 和 `records/<recordId>.json`；禁止目录 entry、附加说明、资源文件、绝对路径、穿越、符号链接和重复文件。上限：压缩包 16 MiB、单 entry 1 MiB、展开合计 32 MiB、总 entry 2048。JSON 最大深度 64，禁止重复键、注释、尾逗号。源文件不是 ZIP manifest，不手工填写 digest。

manifest 七键为 `packageId,namespace,label,versionId,version,digest,records`；索引为 `{id,kind,digest}`。对象键按 UTF-8 字节序排列、数组保序，使用 UTF-8 紧凑 JSON、无 BOM/末尾换行。record SHA-256 覆盖规范 `{id,kind,values}`；包 digest 覆盖 digest 置空的规范 manifest 后，连续拼接按 ID 排序的规范 record 字节，无分隔符。不要使用一般 JSON stringify 猜测 Unicode 转义或重新格式化数值；附带 .NET 工具与服务器使用相同 writer。

ID 为 20 位小写字母数字，前 3 位按 kinds.json。package=`apg`，version=`apv`，RoutineTemplate=`apt`；RuntimeRecord 前缀等于其包对象 keyPrefix。工具 id 命令是 prefix + SHA-256(UTF8(stable-key)) 前 17 位，只是稳定分配方法，不保证全局无碰撞。

namespace 匹配 `^[a-z][a-z0-9]{1,15}$`。对象 API Name 为 `<namespace>__<name>__c`，name 匹配 `[a-z][a-zA-Z0-9]*`，整体不超过 57 字符；对象 keyPrefix 匹配 `^1[a-z0-9]{2}$`，包对象专用区间为 `100`–`1zz`（共 1296 个），后两位按 `0–9、a–z` 排列；`0xx` 区间保留给系统内置对象，即使尚未注册也禁止包对象使用；仍不能占用平台已注册或其他对象前缀。此限制针对 BizObject.values.keyPrefix，不改变 BizObject 记录自身的 `004` 等 kind ID 前缀。version 使用严格 SemVer（不以 0 开头的主次修订数字，预发布数字段也不允许多余前导 0）。同 packageId/version 不同内容拒绝，不能把覆盖旧版本当升级。

包头标签必须非空，按 .NET 字符串长度计不超过 256；版本字符串不超过 64。namespace 与版本必须整串匹配，不能以尾部换行绕过校验。预发布和构建信息的点分段均不能为空；只有预发布中的纯数字分段禁止多余前导零，构建信息中的数字允许保留前导零。离线工具与服务端读取器使用相同包头限制。

## 字段目录与类型

[kinds.json](kinds.json) 精确列出 23 kind 的 prefix、required、optional；未列 values 字段禁止。所有资源顶层只允许 id/kind/values。不声明 tenantId、ownerId、isDeleted、审计、externalId/externalSource、status、账户密码和执行历史。

布尔：isActive/isMuted/nullable/searchable/sortable/isSensitive/allowActorPolicyReference/share2AllRoles/manualSharingEnabled/triggersEnabled/isLocalCall/supportsTrigger/readable/updateable/deleteable。非负 Int32：length/scale/triggerOrder；versionNo 必须大于 0。对象：contractJson/fieldValues/inputModel/fieldLabelOverrides/presentation/fieldPresentationOverrides/subjectCondition/orchestrationExecutionPolicyOverrides。数组：fieldNames/picklistFields/conditions/sort/cellColorRules/filterItems/toRules/ccRules/bccRules。query/headers 编写为对象；其余普通字段为字符串；inputJson/body/value/searchFields 遵循所用能力的 JSON 语义，不把对象双重编码成字符串。

required 中可为 null 的键只有 body/subjectCondition/replyToRule/textBodyTemplate/htmlBodyTemplate。可选字段不使用时优先省略。离线检查允许可选 null 不表示所有业务 owner 都接受它。

## 资源构造约束

| 资源组 | 必须遵守 |
|---|---|
| BizObject / BizField | 对象由服务器固定为自定义 runtime business、trackable、非 alwaysHardDelete，不把这些固定字段放 values。标准 id/tenant/owner/审计字段由 runtime 提供。type 是唯一业务类型，支持 Text/LongText/Number/Decimal/Money/Date/DateTime/Boolean/Picklist/MultiPicklist/UserRef/Lookup；物理存储由平台派生。Text 配 length，Lookup/UserRef 配 targetEntityDefinitionId，Picklist/MultiPicklist 配 valuePicklistId。`UserRef` 引用受保护租户 `User` 对象，固定 `targetEntityDefinitionId=00457d0cb59a8281762b`；包外 Lookup 的结构检查与安装准入分别判断，见下方引用与权限。presentation 仅保存显式覆盖，省略时继承服务端默认 editor/cell/detail；列表 fieldPresentationOverrides 只覆盖 cell。拒绝旧 fieldType/uiType/uiLength。unique=true 仅支持 Text、length 1–255，创建覆盖软删除行的数据库唯一索引（NULL 可重复，必填另设 nullable=false）；重复存量数据阻止升级。仍不支持 indexed/computed 或默认值迁移；新增必填字段会因存量数据进入 Waiting，不静默补 0/空串。 |
| BizListView | fieldNames 为字段名字符串数组，fieldLabelOverrides 为字段名到标签映射；conditions、sort、cellColorRules 分别整体处理。安装不会自动公开视图；Owner 属于绑定。 |
| BizPicklist / BizPicklistItem | 子项 refPicklistId 指向包内父项。选项 name 不变；颜色、标签、active 是业务值。 |
| BizRecordType | picklistFields 为 `{fieldId,usesAllActiveOptions,enabledOptionIds}` 数组；布尔 usesAllActiveOptions、选项 ID 数组，字段必须属于 refObjectId，选项必须属于该字段关联 picklist。 |
| BizTrigger | refObjectId/refOrchestrationId 是包内 ID，单 Trigger 和对象总开关共同生效；不包含派发记录或历史。triggerType 使用目标协议支持的 before/after 事件值，不从 JS 事件名推断。 |
| BizOrchestration / Version | currentVersionId 必须指向本包内且 refOrchestrationId 为该父的版本；versionNo 父内唯一。新源码新增 version record 并改父指针；旧版本 ID、序号、inputModel/source 不改。 |
| BizOrchestrationFunction | key 稳定，source/signature/contractJson 一起审查；contractJson 可省略以兼容旧包；新函数版本要求 schemaVersion=1 的递归 input/output 契约，声明类型、必填字段及数组项；不写 isSystem。脚本仅使用 XRain 允许的调用能力，资源 key 使用静态字面量，引用本包资源；禁止动态拼接依赖、任意模块导入或把秘密放源码。服务端编译和 callable policy 必须通过。 |
| RoutineTemplate | 包内编排、inputJson 匹配输入模型；Owner 必填绑定，初装由服务端固定 Paused，不写 status/currentVersionId/nextRunAt。不自行启用任务。 |
| BizConnector / HttpRequest | baseAddress 是无用户信息/query/fragment 的 HTTP 或 HTTPS URL；使用部署配置的地址和端口，传输及网络访问策略由部署环境负责。method 为 GET/POST/PUT/PATCH/DELETE；path 以 / 开头，无 query/fragment/穿越。query/headers 为对象，GET 不塞业务 body。远程 token 只写 `{{credential.token}}` 占位符，不得写到 path；匿名连接不要求凭据。 |
| BizHttpInterface | permissionName 使用 `httpInterface.<ConnectorName>.<InterfaceName>.execute`（raw）或 `httpInterface.<InterfaceName>.execute`（orchestrated）；系统从有效接口生成权限，包不声明对应 AuthenPermission。PermissionSetItem 可按 refPermissionName 引用该权限；request/orchestration ID 必须与 kind 的原有契约一致；不自动赋权、不放 API token。 |
| AuthenPermission / Set / Item | 包只声明 `custom.<分组>.<能力>` 自定义权限；系统从有效对象/字段元数据生成标准权限，字段 Export 已取消。Item 通过 `refPermissionName` 引用标准权限、包内自定义权限或平台登记租户 API；通过 `refPermissionId` 引用包内自定义权限。两种引用只能选其一，安装预检与运行时均验证目标。Set 可选 `assignmentAudience=explicit|allEmployees`，缺失按 `explicit`；`allEmployees` 仍须安装安全确认和租户 `allEmployeesEnabled` 开关。包不得声明保留名 `xrain-all-employees`。普通人员和角色分配使用租户标准关系管理。 |
| BizSharingRule / Formula | 包规则 filterItems、subjectCondition 和访问位均由包控制。包声明可跨租户执行的完整条件，例如当前行为人的引用；不通过安装提交用户、角色、组织身份或条件绑定。角色分配由系统标准管理维护，本地独立规则可日常编辑。不可将 null 当通配授权；不可为了通过校验删除条件。公式 value 不带 DTO 的 valueKind。 |
| RuntimeRecord | 只对包内对象，fieldValues 只含业务字段，数值用 JSON 数值且保持精度；lookup 值是包内种子 ID。循环引用的所有记录均声明完整 ID；实际约束检查由安装执行，不绕过。删除包种子仅停止管理，不删除用户数据。 |
| Email / Feishu / SMS | 只放模板，不放账号、收件人数据、消息、provider 结果。Email/SMS accountId 必填绑定；Feishu 使用该租户已有唯一账户。SMS providerTemplateCode/signName 必须已有审核，安装 preflight 验证。 |

通用 inputModel 是 `{ "fields": [] }` 或 `{ "fields": [{"name":"customerName","label":"客户名称","type":"string","required":true}] }`。最多 100 字段，name 为 lowerCamelCase 字母数字且大小写无关唯一；type 是 string/integer/number/boolean/object/array；label 最多 100，description 最多 500，example 是最多 16384 字符的字符串，非 string 类型内容必须能解析为对应类型。

支持通用 XLSX 导入的目标可在 `BizOrchestrationVersion.values.inputModel` 内增加官方 `import` 对象，不能放在 values 顶层或新增 kind。例如 `{"fields":[],"import":{"version":1,"inputColumns":[{"apiName":"sourceWeightKg","label":"来源重量","type":"Number","required":true,"unit":"kg"}],"transform":true,"normalizeIdentity":false,"prepareRecord":true,"validate":false,"recordMaintenance":true}}`。fields 仅定义入口固定参数，允许空数组；inputColumns 最多 100 项，API Name 不与 Id/删除或目标列冲突，类型为 Text/Number/Money/Date/DateTime/Boolean，不创建 BizField。先核对目标 capabilities，不向旧目标假定支持。

复用同一 `execute(ctx)` 按 `ctx.input.phase` 分派：来源 transform 可拆合/显式 skip 并保留全部 sourceRefs；normalizeIdentity 只改选定业务键、保持 Id；平台匹配和仅新增默认/更新合并后，prepareRecord 接收完整目标候选，只改可写值；validate 只返回 issues。阶段可选，固定 parameters 来自入口；消费方提供独立稳定 importSourceKey，EventId 保留原事件链。importTransform 只许可受控函数和获权直接 runtime 读取，禁止写入/投递/raw HTTP，normalizeIdentity 仅纯计算。维护回导跳过来源转换/input-only，但保留共同阶段；删除只需身份并跳过来源转换/准备。输入输出必须遵循目标公开阶段 DTO，离线容器校验不替代服务端编译/运行验证。

文件 API 的包权限集可按 `refPermissionName: "api.xrain.runtime.records.import"` 引用已登记的租户导入目录权限；导出复用 records.export。引用不自动分配人员/角色，也不替代对象、字段或记录授权。

嵌套筛选、排序、颜色规则、地址规则、模板语言、脚本 callable 与执行策略是 XRain 能力合同，不是任意 JSON。基础生成器不证明这些语义。对没有完整规格或已批准示例的复杂配置，不猜测枚举/结构、不伪造可安装性；先生成可表达部分并明确缺口，或从目标正式 API schema 获取该能力规格后再生成。目标不提供规格且不能合法表达需求时停止，不私自扩展包格式。

## 普通记录更新脚本

编排、Trigger、Routine 和应用 Function 调用 `runtime.records.update` / `runtime.records.batchUpdate` 前核对目标 callable 目录。普通记录更新使用新 `values` 和可选 `expectedValues`：省略、null、空对象为直接更新；字段显式 null 是空值条件；已给业务字段旧值全部匹配才写入，也可核对本次不修改的业务状态字段。保留实际需要的状态、负责人及指派版本条件，不附加整行审计时间。

普通记录已删除 `expectedUpdatedAt`，也不接受 `expectedValues.updatedAt`。旧值须来自获权读取的实际字段；签名 JSON 用原始返回内容，不重新序列化，不使用脱敏占位值。409 后保留未保存内容，明确处理冲突后再提交，不能自动换成最新旧值或丢弃条件重试。仅传新值的原调用仍可直接更新，不强制每个脚本读后再写。

修改共享输入前识别并迁移包脚本及 HTTP/SDK/页面消费者，验证旧时间输入在写入前被拒绝、可选与 null 条件及业务状态保护。已发布编排版本保持不可变，按正常包升级形成新版本；目标缺少字段条件能力时明确交付缺口，不能恢复旧时间参数或静默降级。包容器和 kind 协议不因该运行时输入改变。

## 引用与权限

关联是字段元数据：设计接口使用 `type=Lookup` 和 `targetEntityApiName`，包的 `BizField` 使用 `targetEntityDefinitionId` 指向目标对象的稳定元数据 ID。包内对象使用本包的对象记录；引用其他包时先核对目标对象身份在各环境是否稳定、当前租户是否有效以及实际用户权限。不要额外创建关系表、复制目标对象或把名称冒充 ID。离线工具对包外 Lookup 返回 `unresolvedLookupTargets`；它不知道目标是否存在，不把该结果解释为可以安装。

包读取器、租户安装预检和普通字段设计是不同入口。读取器检查 ID 格式与包内同 ID 的类型；安装预检还须按目标版本解析当前租户的有效定义。支持包外 Lookup 的实现可解析同一租户另一已安装应用的有效对象，并在升级或卸载目标时检查有效反向引用；其他租户、隐藏、已卸载或类型不符的目标不能因此通过。旧版本可能仍只查本包候选集合与固定定义，不能把旧回执中的限制当作平台永久缺口，也不能把本地修复当作目标环境已经更新。

先核对目标版本、有效元数据与预检回执，再判断是目标不可用、权限问题还是实现缺口。保留正确的字段模型及待验证源码，继续不依赖该关联的授权工作；确属实现缺口时由平台维护者核对安装和反向引用检查，不额外设计一套依赖机制。不得改用管理员身份或关闭校验。包对象下新增本地字段也须通过其实际候选预检，不能假定它绕过版本限制。

其他引用默认保持包内闭包：对象/字段/视图/记录类型/Trigger/共享规则指向包内对象；选项指向包内 picklist；版本和 Routine 指向包内编排；请求指向包内 connector；接口指向包内请求/编排；PermissionSetItem 指向包内 set/permission。`UserRef` 的固定受保护 `User` 引用是独立例外，不能泛化成任意人员对象。系统标准权限不属于包记录：`refPermissionName` 可引用本包有效对象/字段/HTTP 接口派生的标准权限、包内 `custom.*` 权限或包引用白名单中的业务数据/元数据 API 与成员资料读取权限；安全目录和身份、角色、权限、令牌管理不在许可范围；引用不携带环境 ID，也不会复制权限实体。`refPermissionId` 仅用于包内自定义权限；系统标准权限必须按名称引用。

标准权限由系统从有效元数据生成：`platform.entity.<entityApiName>.<action>`（read/create/edit/delete/export）；业务字段 `platform.field.<entityApiName>.<fieldApiName>.<action>`（read/create/edit；敏感性及脱敏方式是字段属性，普通响应始终脱敏，单记录显式原值读取要求对象/记录可读与字段 read，不要求 edit）；标准字段只有 read。ID=`00d`+SHA-256(lowercase(packageId+`|derived-permission|`+permissionName)) 前 17 位。包内 `AuthenPermission` 只允许 `custom.<分组>.<能力>`，例如 `custom.orders.approve`；引用标准权限时只声明 PermissionSetItem，不声明对应 AuthenPermission。

字段 Export 已取消，不生成、不引用，也不把旧 Export 转为 Read。对象 Export 与业务导出能力不能授予读取，只能导出当前身份按 Read、记录范围与脱敏规则本来可读的数据。标准字段 read 可引用 id、ownerId、createdById、createdAt、updatedById、updatedAt、isDeleted、deletedById、deletedAt、tenantId、externalId、externalSource。

包携带任一标准 AuthenPermission 即拒绝导入，不做旧声明兼容、静默删除或迁移。生成器离线检查与服务端导入检查均在写入前执行；通过包校验后，仍必须通过目标租户安装预检。

## 不可变字段与升级

保留旧版本源码用于比较：对象 keyPrefix/entityApiName；字段 entityDefinitionId/fieldApiName/type/unique/targetEntityDefinitionId/valuePicklistId；列表和记录类型 name/refObjectId；选项集 name；选项 name/refPicklistId；Trigger name/refObjectId；编排 name；函数 key；Routine name/refOrchestrationId；connector name/isLocalCall（本地 baseAddress 也锁定）；request name/refConnectorId；interface name/kind/refHttpRequestId/permissionName；权限/权限集/共享公式/邮件/飞书模板 name；共享规则 name/refObjectId；Item refPermissionSetId/refPermissionId/refPermissionName；SMS localTemplateKey；种子 entityDefinitionId。编排 version 四个业务字段全部不可改。

变更身份必须移除旧记录并新增新身份，但不能用此手法避开数据、依赖和权限确认；历史 recordId 不可改身份后再引入。新版本是完整记录集合，不是 JSON patch。服务端先执行封闭 I/P/T/D 策略再处理配置兼容；不能从租户导出结果直接重写全局基线。

安装配置不提供共享规则编辑入口。可移植规则使用受支持的当前主体表达式；不要生成需要安装时填写固定租户身份的规则模板，具体租户的角色范围在标准管理维护；包条件由新包版本更新。权限集与具体用户/角色的分配关系不属于包声明。声明为 `allEmployees` 的权限集只允许租户通过受控安装开关授权当前及未来的有效员工，包中不能写用户、角色或租户身份。

I 为上述发布后不可变属性；P 由新包版本更新，租户不能覆盖；T 初装固定，升级保留（包括与旧默认相等、缺失和 null）；D 是种子实际业务值，创建后沿业务权限管理。除 I 和下列 T/D 外，kinds.json 中其余允许属性均为 P，未知属性或自定义控制策略拒绝：

| kind | T / D |
|---|---|
| BizObject | T searchFields/share2AllRoles/manualSharingEnabled/visibilityScope |
| BizField | T searchable/sortable/presentation；不改变实际存储与数据授权 |
| BizListView | T label/helpText/fieldNames/fieldLabelOverrides/fieldPresentationOverrides/conditions/sort/cellColorRules |
| BizPicklistItem | T color |
| BizRecordType | T isActive/picklistFields |
| RoutineTemplate | T inputJson/scheduleType/executeTime/timeZoneId，由实际 Routine 持有；新周期声明 IANA 地区，缺地区的旧包保持 Paused，配置后才可启用 |
| BizConnector | T baseAddress，仅远程 |
| RuntimeRecord | D fieldValues；既有行不覆盖、硬删后不复活 |
| InfraEmailTemplate | T toRules/ccRules/bccRules/replyToRule/subjectTemplate/textBodyTemplate/htmlBodyTemplate |
| InfraFeishuTemplate | T messageType/contentTemplate |
| InfraSmsAliyunTemplateBinding | T providerTemplateCode/signName/remark，由实际绑定持有 |
| 其余 12 kind | 无 T/D |

包对象允许独立本地字段/视图/记录类型/Trigger/共享规则，包连接允许本地请求；包选项集、权限集和编排父项不允许插入本地成员/源码版本。复制只建立新本地身份，不复制秘密、授权、Owner、运行历史或业务行；原包引用不变。只有包视图允许隐藏，不能将 Retained 解释为所有权转移。安全与执行组件退出后不可继续授权或执行；Routine 暂停并保留同一实际 ID/历史，SMS 软删除并重引入同一 ID；卸载保留物理结构与业务数据，反向依赖未解除时拒绝。新输入合同须兼容保留的模板/Routine 配置，否则通过候选草稿修复或取消，不能自动覆盖 T。

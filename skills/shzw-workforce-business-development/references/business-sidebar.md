# 自定义业务侧栏与智能体

产品事实：Workforce 会话工作区和公开 Application SDK；执行与界面工具由 Agent Runtime 提供。业务组件、目标参数及授权由业务应用负责。
维护与适用：本专题由 skills-hub 维护，面向企业应用的公开能力。示例说明当前源码及 SDK 合同，不证明目标环境已经安装对应版本，也不授权修改在线配置。先核对目标项目提供的依赖、公开导出、Runtime 和实际主体权限。

## 选择侧栏能力

1. 列表、记录详情、字段和已有关系可由通用低码视图完成时，配置现有记录侧栏，按有效对象、视图、字段和业务权限使用。不要为同一记录页面另造专用侧栏。
2. 业务确需专用布局、实时计算、原系统数据或组合交互时，使用应用公开的侧栏贡献方式。客户端注册组件；服务端注册同 ID 和类型的业务贡献及目标校验。按应用现有装配和插件生命周期释放贡献。
3. 人工卡片与智能体需要展示同一内容时，先查现有侧栏目标和服务合同。共用业务目标、数据来源和授权，不把模型文字当成业务记录，也不通过模拟鼠标维持第二条业务逻辑。

侧栏只解决内容展示和业务交互。身份、权限、计算和保存仍由相应业务服务承担。原系统已有接口可沿[集成](integration.md)复用；无需先复制数据模型。

## 注册业务侧栏

在公开的 `@xrain/workforce-application/client` 类型中，`WorkbenchSidebarProps` 提供 `sessionId`、`instanceId`、`primaryObjectRef`、`target` 及 `onTargetChange`、`onDirtyChange`、`onPendingChange`、`onPresentationChange` 等回调。实际字段以目标安装版本的公开类型为准。

客户端使用 `workforce.workbench.scenario` 贡献带稳定 ID、名称和类型的组件；服务端通过应用支持的插件入口贡献相同 ID 和类型，并校验业务目标。组件读取 `target`，按当前用户会话调用本业务已认证服务；页面传入的对象引用不能作为授权依据。组件卸载、会话切换和身份变化时取消旧请求，按本人、会话及实例隔离必要输入。

已有 Host/Client 插件可以沿现有 `apply(ctx)` 和 `ctx.effect` 装配。下面展示登记关系；`RepairSidebar` 和 `handleRepairHttp` 由业务应用实现，并分别完成页面读取与获权服务路由。该片段不是可直接部署的完整应用：

```js
// 客户端插件入口
export const inject = ['workforceUi'];
export function apply(ctx) {
  ctx.effect(() => ctx.workforceUi.register(
    'workforce.workbench.scenario', 'repair-order', RepairSidebar,
    { label: '维修工单', kind: 'repair-order' }
  ));
}
```

```js
// 服务端插件入口；登记到应用已有的 HTTP 处理器。
export const inject = ['workforceHttp'];
export function apply(ctx) {
  ctx.effect(() => ctx.workforceHttp.register('repair-service', handleRepairHttp, {
    sidebarPlugins: [{
      id: 'repair-order', label: '维修工单', kind: 'repair-order',
      validateTarget(_context, target) {
        if (!target || Object.keys(target).length === 0) return;
        const input = target.parameters;
        if (Object.keys(target).some(key => key !== 'parameters') ||
            !input || typeof input !== 'object' || Array.isArray(input) ||
            Object.keys(input).some(key => !['mode', 'recordId'].includes(key)) ||
            input.mode !== 'detail' || typeof input.recordId !== 'string' || !input.recordId.trim()) {
          throw Object.assign(new Error('Invalid repair target'), { status: 422 });
        }
      }
    }]
  }));
}
```

服务端目标校验只验证当前贡献支持的目标结构；`handleRepairHttp` 仍须从可信请求取得本人身份，并在读取工单时核验当前会话和业务权限。空目标允许先加载入口；如业务不支持空目标，应按实际公开合同处理。目标被读取并渲染后，组件通过 `onPresentationChange` 报告匹配目标的 `displayed`；读取失败报告 `failed`。不要在仅收到参数或开始请求时报告已显示。

在智能体定义的 `uiPlugins` 中选择该侧栏，配置入口及适用条件。`pluginId` 指贡献，`entryId` 指定义中的配置项，`instanceId` 指打开的具体内容；名称不是标识。`initiallyLoaded` 与 `defaultActive` 分别控制初始装入和默认激活。定义配置不授予记录或字段权限；目标环境还需实际装配该插件并允许当前用户使用。

例如，以下只是定义中 `uiPlugins` 的一项；对象标识须取自目标环境的有效目录，不能直接照抄示例：

```json
{
  "pluginId": "repair-order",
  "entryId": "repair-order",
  "availability": "conditional",
  "when": { "object": "linked", "businessSourceId": "xrain", "objectTypes": ["实际顾客对象标识"] },
  "initiallyLoaded": true,
  "defaultActive": false
}
```

该配置让符合条件的会话装入侧栏，但不将其设为默认激活项。保存定义和应用选用使用现有管理入口及真实版本；还须按业务需求配置 `assistantTools` 和当前主体的数据权限。

## 目标参数和结果卡片

`WorkbenchSidebarTarget` 的现有公共结构包括可选的 `viewId`、`objectType`、`objectRef`、`intent`、`listViewName`、`query`、`expanded` 和 `parameters`。其中 `parameters` 是业务侧栏可解释的 JSON 对象；通用记录视图仍按其对象和查询合同传参。业务必须声明并校验参数含义、必填条件和可接受的引用，不能让客户端指定调用主体或越过固定业务范围。

客户端可在 `workforce.workbench.service-results` 贡献工具结果卡片。`WorkbenchServiceResultProps` 提供原生工具 `receipt`、`sessionId`、当前渲染的 `cardId`、`MessageCard` 和可选 `onOpenSidebar`。`cardId` 用于当前卡片实例，不是公开保证的工具调用标识；跨历史分页或重建时不得仅凭它恢复业务结果。以维修记录为例，以下片段只演示已取得真实结果后的目标构造和打开调用，不是完整插件：

```ts
import type { WorkbenchSidebarTarget, OpenServiceSidebar } from '@xrain/workforce-application/client';

async function openRepairRecord(open: OpenServiceSidebar | undefined, recordId: string, cardId: string) {
  if (!open) return;
  const target: WorkbenchSidebarTarget = { parameters: { mode: 'detail', recordId } };
  await open('repair-order', target, `repair-${cardId}`, '维修工单');
}
```

这里的 `repair-order`、`mode` 和 `recordId` 是示例业务约定，不是平台预置字段。生产组件从真实回执取得记录标识并处理打开失败；不可解析模型编写的回复来代替回执。宿主重验侧栏资格，业务服务按当前主体、会话、对象及字段权限读取详情。

侧栏定位状态用于恢复实例、目标及查询，不保存业务记录、草稿、凭据或权限快照。目标是已保存记录时，用可获权的稳定记录标识读取；临时结果优先复用原业务结果及实际提供的会话合同，不把完整草稿放入导航参数。结果过期或无法核验时沿业务入口恢复，不猜测内容。

## 智能体如何使用

业务服务操作可以使用定义中的 `assistantTools`，由服务提供可执行的参数描述和结果；符合条件的 `businessActions` 也可使 Runtime 注册通用业务记录工具。任务上下文可以另有获准的任务工具。智能体不能以传参覆盖租户、调用人或固定业务目标。需要读写或计算时，人工页面和工具优先调用同一业务服务。定义和工具接线见[业务实现](implementation.md)与[智能体定义](agent-access.md)。

启用界面能力且生效定义包含侧栏时，Runtime 可在会话轮次动态提供 `ui_` 工具，独立于业务工具和可选原生工具。当前源码在生效定义的 `uiPlugins` 非空时尝试注册；人工界面继承默认侧栏，不代表智能体一定获得这些工具。当前源码提供 `ui_list_plugins`、`ui_load_plugin`、`ui_activate_plugin`、`ui_set_sidebar_visibility`、`ui_open_record`、`ui_get_presentation_status`、`ui_get_view_context`、`ui_execute_action`、`ui_open_related`、`ui_return_to_record` 和 `ui_open_business_application`。具体注册与可用情况取决于目标 Runtime、宿主、配置和本次主体；`agent tool business` 的业务工具目录不能证明界面工具不存在。

智能体先通过 `ui_list_plugins` 读取本轮可用配置和实例，再选择用户所指的业务内容。`ui_load_plugin` 可装入或激活可用侧栏，`ui_activate_plugin` 可切换已打开实例；`ui_open_record` 适用于已接入的低码对象和记录。当前 `ui_load_plugin` 没有自定义 `target` 参数；不能把人工卡片可传 `parameters` 误认为智能体工具已能传递。若业务需要智能体打开具体自定义目标，核对目标制品是否提供该能力；缺口交 Workforce 和 Runtime 的公共协议所有者处理，不新增业务专属平行导航工具。

当前 `ui_get_view_context` 和 `ui_execute_action` 仅适用于实际贡献观察或动作能力且具备相应资格的页面，不等于可以读取任意 DOM、未提交草稿或点击所有按钮。展示与保存分开确认：`prepared` 只表示目标已准备；匹配目标的 `displayed` 才表示浏览器确认显示；`blocked`、`failed`、`superseded` 或 `unknown` 不能报告为显示成功。

## 人机共用目标的拟议扩展

以下是公共产品待实施的设计方向，不是当前可调用接口。业务项目不得在未核实目标版本时按此调用，也不应为个别业务另造长期并行导航协议。

- 业务贡献描述支持的 `WorkbenchSidebarTarget` 及 `parameters` 含义；拟议通过目录 `plugins[].targetSchemaVersion: 1` 和 `plugins[].targetSchema` 返回可发现的 JSON Schema。业务目标及参数由各贡献定义，不由公共工作台维护业务枚举；未知合同版本不按版本 1 猜测。
- 拟议在现有 `ui_load_plugin` 上增加可选 `target`，结构与人工调用 `onOpenSidebar` 的目标相同。不传时保留原有装入语义。以下示例中的 `target` 当前尚不可用于该工具：

```json
{
  "entryId": "repair-order",
  "target": { "parameters": { "mode": "detail", "recordId": "来自实际业务查询的标识" } },
  "activate": true
}
```

- `entryId` 选择当前获准配置，`target` 选择业务目标。带目标时按入口和规范化的业务目标决定复用或创建实例。拟议的业务贡献可提供 `resolveTargetIdentity(target)`，从已校验目标生成可比较的 JSON 身份；未提供时按完整规范化目标比较。公共协议不替各业务解释 `parameters.openId` 等自定义字段。相同实例的未保存输入不得静默覆盖；无目标调用保持原有行为。参数描述不授予权限；Host 和业务服务重新核验本人、会话、贡献及业务数据。
- 拟议的 `resultRef` 包含 `sourceSessionId` 和 `invocationId`，定位同一根会话内实际执行的一次工具调用。Runtime 为允许引用的业务工具向模型提供 `__workbench.resultRef`，并在原生 `assistantServiceResult.resultRef` 提供同一引用给结果卡片。Runtime 扩展现有历史读取合同，提供拟议的 `resolveServiceResult(sessionId, resultRef)`，以该引用定位同次输入和结果；当前公开卡片合同尚未提供此能力。引用不是权限凭据；服务重新核验本人、会话、业务目标和字段权限。不将草稿、完整业务记录或权限快照写入导航状态。
- `prepared` 表示请求已准备；只有实际组件针对匹配目标返回 `displayed` 后，智能体才能说明已显示。阻挡、失败、被替代及未知分别保留实际结果；显示回执不证明保存成功。

公共实现交付后，由 Workforce 与 Runtime 的公开类型、目录及验收证据确认最终字段和兼容性；技能使用知识随已发布合同更新。

## 开发和验证顺序

1. 确认目标项目、公开 SDK 版本、业务服务、当前主体和需要展示的真实业务结果。区分已有记录与未保存输入。
2. 定义业务侧栏目标字段、校验和读取范围。注册客户端及服务端贡献，并在智能体定义配置可用条件。保持与已有侧栏、工具及应用资格的关系。
3. 将业务操作暴露为有描述和参数合同的服务工具。人工入口和智能体使用相同业务结果及业务规则；工具结果只返回当前主体获权内容。
4. 人工从真实卡片传入 `target`。智能体按目标 Runtime 已支持的界面工具选择或打开内容；如缺少同目标传参或页面动作，记录公共能力缺口，不声称已实现。
5. 验证实际业务入口的同一目标、参数、权限和结果；另核对草稿、切换会话、撤权、加载失败及显示回执。保存操作单独核对实际业务结果。若只有源码或组件测试，明确不等于目标运行环境的完整验证。

面向所有业务的自定义目标发现与智能体传参扩展仍需由公共产品实际交付后再使用。本专题记录当前可用接口及缺口，不将拟议工具参数当成已发布合同。

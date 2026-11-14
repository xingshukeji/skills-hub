# 可发现的智能体工具

产品事实：Workforce 与 Agent Runtime。以目标安装包公开的 `ToolFile`、`ToolContext` 及定义 options 为准；源码有新合同不表示现有部署已更新。

## 选择接入方式

新增工具优先使用宿主已有文件发现机制，不另建注册表。公共模块放在该模块包的 `host/tools/**/*.tool.mjs`；企业专有工具放在项目 `backend/tools/**/*.tool.mjs`。宿主只扫描已激活模块及配置的企业工具根，文件名必须以 `.tool.mjs` 结尾。普通 `.mjs` 辅助模块不会自动成为工具。文件变化按项目原启动入口重启后端生效，不承诺热更新。

已有 `listTools` / `invokeTool` 回调仍可使用，不能为符合新目录无授权迁移既有服务。文件来源和回调中同名或相同身份的工具冲突会被拒绝，不使用优先顺序偷偷覆盖。工具文件是受信服务端代码；不要加载用户上传的任意模块。

## 完整文件示例

以下文件放到企业项目 `backend/tools/current-member.tool.mjs`。它读取本次真实执行主体，默认作为可选工具，不扩大权限，也不接受调用者指定其他用户。

```js
/** @satisfies {import('@xrain/workforce-application/host').ToolFile} */
export default {
  protocolVersion: 1,
  tool: {
    name: 'service_current_member',
    serviceId: 'member-tools',
    operation: 'currentMember',
    description: '读取本次执行的真实成员身份；不能查询其他成员。',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  displayName: '查看本人身份',
  category: 'business',
  entries: ['personal', 'application', 'employee'],
  defaultAvailable: false,
  effect: 'read',
  async execute(_arguments, context) {
    context.signal.throwIfAborted();
    return { tenantId: context.principal.tenantId, memberId: context.principal.principalId };
  },
};
```

`tool.name` 使用稳定、唯一的 `service_` 名称；`serviceId` 和 `operation` 标识真实服务操作。parameters 是对象 JSON Schema，必须关闭额外属性。displayName 说明用户可以做什么；description 为模型解释输入、输出及限制，不把整段调用指令直接铺在管理页面上。effect 只声明读写性质，不代替业务鉴权或幂等处理。

处理器使用 `context.platformRequest` 调用本次执行者的获权平台 API；`context.hostRequest` 只访问宿主允许的 `/api/cli/v1/` 路由。完整方法、DTO 和业务错误从已交付的 API 合同取得，不拼接猜测的接口。取消信号传给下游操作。租户、用户、会话和调用号由可信上下文提供，不接收模型指定的凭据或替代用户。

没有声明目标时使用当前宿主应用；需要其他业务应用时通过 `targetApplicationId` 或 `resolveTarget(context)` 取得真实目标，两者互斥。来源应用和目标应用都按当前主体准入；目录可见不授予目标数据权限。返回结果引用时同时声明 `tool.resultReference: true` 和 `resolveResult(reference, context)`，沿原会话和主体复验，不自造卡片或金额。

## 目录能力和定义选择

当前 Runtime 只启用定义在 `assistantTools` 中明确选用、与当前目录匹配且适用于本次 entries 的服务工具。`defaultAvailable` 是目录兼容信息，不会自动授权；`assistantTools: []` 表示不启用服务工具。新增文件被发现或目录能够列出提醒工具，都不等于销售会话已经取得该能力。

`inheritDefaultAssistantTools` 是旧定义的兼容字段，当前实现不据此自动加入目录工具；不能用它代替明确选择。工具名称和服务操作保持稳定，选择时保存当前目录的参数合同。旧参数能否沿用由目标 Runtime 的兼容规则判断，不能按名称相同推断任意参数变更都兼容。

`disabledAssistantTools` 继续兼容已有单项关闭配置，按稳定工具名称排除，优先于显式选择。提供者暂时不可用时保留关闭项。恢复某项时核对它仍有明确选择；移除关闭项不会授权一个从未选择的工具。旧文件省略关闭字段时保留目标原值。

工具用途与默认启用状态分别声明。服务工具的 `category: 'business'` 表示企业业务能力，例如车型和报价；`category: 'general'` 表示通用能力，例如 Workforce 的消息和计划。省略 category 按 business 处理。文件、搜索和终端等原生能力单列为基础工具；不能仅因 defaultAvailable 为 true 就把工具归为业务能力或基础工具。

定义管理页面显示目录中的可选工具及已保存选择；设置取消恢复完整草稿，保存后重新读取核对。模型只决定调用已获准能力，不能自行启用未获准工具。工具改变后在下一轮装配，并在每次调用前复验当前定义；已经开始的业务操作仍以真实回执判断。

旧 Runtime 不支持关闭字段时，明确报告版本能力缺口，不能只改页面勾选后声称已经关闭。定义的导出、导入、局部编辑和完整发布均保留关闭项；旧文件没有该字段时保留目标选择，不能用导入悄悄撤销已有关闭配置。

## 从文件到真实业务验证

项目预置定义的工具变更，先按[来源与交付实例](project-development-ownership.md#修复先确定来源与交付)核对源文件和生成器，再执行以下目标操作。现场选用用于验证时，仍须完成对应的源码修复和制品消费验证。

1. 安装目标项目的声明依赖，核对宿主和 Runtime 来源，按原入口装入模块并重启。模块裁掉后其工具必须从目录撤除，并取消该来源尚未完成的调用。
2. 使用 CLI `agent tool business` 查看真实目录的名称、参数、entries、defaultAvailable、targetApplicationId 和 issues；再用 `agent tool show <agentId>` 对照定义选择与关闭项。目录读取完整不等于具体会话已经取得工具。
3. 按需通过定义页面或 `agent tool set <agentId> --expected-revision <当前版本> --values-json <选择文件>` 保存；保持无关工具、指令、工作区及使用关系。关闭某项时合并现有关闭数组，恢复某项时只移除对应名称。
4. 从工具声明支持的实际入口，用原主体调用并核对业务数据或真实回执；同时验证未选、关闭、撤销权限和参数错误不会触发业务写入。说明文字变化不应丢失稳定调用选择，参数结构变化则必须重新核对。
5. 写入返回未知时沿原业务键查询，不换键重建。重试、幂等与部分失败由业务操作负责，不能把 HTTP 成功或模型轮次结束当成业务完成。

定时计划是现有业务工具消费者：创建、本人启用、到点执行和结果交付分别核验。能创建安排不代表所选定义能读文件、发送结果或维护平台业务编排。销售定时工作按原业务权限运行；平台函数、编排和 Routine 的管理另按[自动化](automation.md)及实际授权处理。

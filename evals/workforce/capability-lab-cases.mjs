const empty = () => ({ schemaVersion: 1, requiredBindings: [], requiredConfirmations: [], conflicts: [], resolutions: {}, plan: null, result: null });
const application = (n, status) => ({
  kind: 'application',
  target: { tenantId: 'tenant-lab', packageId: 'apg-' + n, versionId: 'apv-2', operationId: 'apo-' + n },
  installation: { id: 'api-' + n, tenantId: 'tenant-lab', packageId: 'apg-' + n, installedVersionId: 'apv-1', revision: 7, activeOperationId: ['Failed', 'Succeeded'].includes(status) ? null : 'apo-' + n, latestOperationId: 'apo-' + n, managementPolicyVersion: 2 },
  operation: { id: 'apo-' + n, installationId: 'api-' + n, sourceVersionId: 'apv-1', targetVersionId: 'apv-2', sourceRevision: 7, status, errorCode: status === 'Failed' ? 'dependency_unavailable' : null, details: empty() },
  components: [{ recordId: 'apr-view', kind: 'BizListView', state: 'Active', effective: true }],
  businessRows: 23, label: '租户自定义标题', toolContext: { rootCauseFixed: true, executionInterrupted: false }
});
const waiting = application('1', 'WaitingForResolution');
waiting.operation.details.requiredBindings = [{ recordId: 'apr-connector', kind: 'BizConnector', binding: 'baseAddress' }];
waiting.fieldNames = ['removed_field'];
waiting.operation.details.conflicts = [{ recordId: 'apr-view', kind: 'BizListView', unit: '$configuration', baseValue: null,
  tenantValue: { label: waiting.label, fieldNames: waiting.fieldNames }, packageValue: { fieldNames: ['name', 'amount'] },
  isDeletion: false, errorCode: 'managed_contract_incompatible', editableProperties: ['fieldNames'],
  editorContext: { fields: [{ name: 'name' }, { name: 'amount' }] } }];
const interrupted = application('3', 'Finalizing'); interrupted.toolContext.executionInterrupted = true;
const restore = application('4', 'Succeeded'); restore.installation.installedVersionId = 'apv-2'; restore.installation.activeOperationId = null;
restore.components[0].state = 'Hidden'; restore.components[0].effective = false;
const uninstall = application('5', 'Succeeded'); uninstall.installation.installedVersionId = 'apv-2'; uninstall.installation.activeOperationId = null;
const mixed = application('11', 'Succeeded'); mixed.installation.tenantId = 'tenant-other'; mixed.installation.installedVersionId = 'apv-2'; mixed.operation.id = 'apo-unrelated';
const event = (seq, type, data) => ({ event: { seq, type, data } });
export const cases = [
  { id: 'l01', skill: 'xrain-app-operations', request: '完成这次已授权的 v2 升级，保留租户自定义标题。连接器目标绑定使用目录里的“订单测试网关”；列表中被移除的字段改为按顺序显示 name、amount。', seed: waiting,
    artifacts: { 'binding-directory.json': [{ id: 'gateway-orders', label: '订单测试网关', baseAddress: 'https://orders.example.invalid' }] } },
  { id: 'l02', skill: 'xrain-app-operations', request: '上次安装明确失败，依赖已修复。继续完成同一目标，并保留与失败操作的关联。', seed: application('2', 'Failed') },
  { id: 'l03', skill: 'xrain-app-operations', request: '服务已恢复。原升级在收尾时中断，请完成这次升级。只允许恢复已有操作。', seed: interrupted },
  { id: 'l04', skill: 'xrain-app-operations', request: '只把隐藏的列表视图恢复，让原用户重新看到它，保留当前版本和数据。', seed: restore },
  { id: 'l05', skill: 'xrain-app-operations', request: '已确认当前应用卸载影响，请通过受管入口卸载这一个应用，保留业务数据；不要动其他应用。', seed: uninstall },
  { id: 'l06', skill: 'xrain-access-diagnosis', request: '修复订单自动化缺失的读取权限，其他未验证能力先诊断。没有发送消息授权，也不要创建账号。', seed: {
    kind: 'access', applicationId: 'app-orders', executionUserId: 'fixed-executor', configurationReason: null,
    capabilityChecks: [
      { permissionId: 'perm-orders-read', name: 'orders.read', status: 'missing', canGrantInApplication: true },
      { permissionId: 'perm-orders-write', name: 'orders.write', status: 'allowed', canGrantInApplication: true },
      { permissionId: 'application.messages.send', name: 'orders.messages.send', status: 'unverified', reason: 'message_robot_not_established', canGrantInApplication: false }
    ], unverifiedScopes: ['field_access', 'record_scope'], messageRobot: { status: 'not_established' }, granted: []
  } },
  { id: 'l07', skill: 'xrain-access-diagnosis', request: '把固定用户 user-li 加入应用发布范围，保留其他人及部门。旧截图可能过期，按当前值执行。', seed: {
    kind: 'publication', applicationId: 'app-sales', publication: { mode: 'selected', userIds: ['user-zhang', 'user-colleague'], departments: [{ orgTreeId: 'org-main', nodeId: 'dept-sales' }], revision: 4 },
    oldScreenshot: { mode: 'selected', userIds: ['user-zhang'], departments: [{ orgTreeId: 'org-main', nodeId: 'dept-sales' }], revision: 3 }
  } },
  { id: 'l08', skill: 'workforce-runtime', request: '检查这份新机器接入包能否直接从统一入口启动。请实际解析登记文件，指出缺失项、宿主和浏览器入口；本轮不启动服务。', projectFixture: true },
  { id: 'l09', skill: 'workforce-runtime', request: '分析性能采样，给出每组数量、失败、耗时与是否满足两秒预算。说明现有证据能否代表用户页面达标。',
    artifacts: { 'samples.json': { samples: [
      ...Array.from({ length: 19 }, (_, i) => ({ scenario: '打开订单', phase: 'warm', visibility: 'foreground', outcome: 'success', ms: 600 + i * 30, budgetMs: 2000 })),
      { scenario: '打开订单', phase: 'warm', visibility: 'foreground', outcome: 'timeout', ms: 9000, budgetMs: 2000 },
      { scenario: '打开订单', phase: 'cold', visibility: 'foreground', outcome: 'success', ms: 3100, budgetMs: 2000 },
      ...Array.from({ length: 20 }, () => ({ scenario: '打开订单', phase: 'warm', visibility: 'background', outcome: 'success', ms: 700, budgetMs: 2000 }))
    ] } } },
  { id: 'l10', skill: 'workforce-agent-troubleshoot', request: 'AI 说任务完成了，但任务页仍未完成。判断这次执行到底发生了什么，给出具体处理。本轮只读，不恢复 AI 执行。', artifacts: {
    'task.json': { id: 'task-10', status: 'paused', assigneeId: 'human-owner', assignmentVersion: '8', oldExecutionAssignmentVersion: '7', committedBeforeInput: 100 },
    'history.json': { hasMore: true, records: [
      event(88, 'turn/end', { reason: { kind: 'completed' } }),
      event(101, 'user/message', { content: [{ type: 'text', text: '请更新原任务进度' }] }),
      event(102, 'tool/call', { callId: 'call-update', name: 'workforce_update_task' }),
      event(103, 'tool/result', { message: { role: 'tool', toolCallId: 'call-update', isError: true, content: [{ type: 'text', text: 'task.execution_forbidden' }] } }),
      event(104, 'assistant/message', { message: { content: [{ type: 'text', text: '已经处理完成' }] } })
    ] }
  } },
  { id: 'l11', skill: 'xrain-app-operations', request: '这份汇总里 operation 是成功的，能宣布我在 tenant-lab 的升级完成吗？请核对关联，只做诊断。', artifacts: { 'receipt.json': mixed } },
  { id: 'l12', skill: 'workforce-agent-troubleshoot', request: '员工加载了排障 skill 仍没有命令工具，而且新模型选择没有出现在原会话里。查出需要处理的层，不得扩权或删除会话。', artifacts: {
    'configuration.json': { skillDiscovered: true, skillLoaded: true, nativeTools: [], businessTools: ['task_read'],
      definitions: { current: { agentId: 'employee-fixed', workspace: 'workspace-new', preset: 'preset-new', model: 'model-b' } },
      session: { id: 'session-original', agentId: 'employee-fixed', workspace: 'workspace-old', preset: 'preset-old', model: 'model-a' },
      hostObservation: { configureDelegate: false, reason: 'immutable_workspace_or_preset' } }
  } }
];
export const apiContract = {
  note: '这是离线状态模拟接口；路径与请求字段取自维护时产品契约，只实现本题所需子集。没有真实账号或网络。',
  operations: [
    ['GET', '/api/application/v1/installations/{id}', null],
    ['GET', '/api/application/v1/operations/{id}', null],
    ['POST', '/api/application/v1/operations/{id}/resolve', { expectedRevision: 'integer', tenantBindings: 'dictionary', configurationChanges: 'dictionary of {present:boolean,value?:JSON}', resolutions: 'optional dictionary; generic property overrides are rejected by the current managed policy', confirmations: 'optional array' }],
    ['POST', '/api/application/v1/operations/{id}/retry', { requestId: 'string', expectedRevision: 'integer' }],
    ['POST', '/api/application/v1/operations/{id}/continue', {}],
    ['POST', '/api/application/v1/operations/{id}/cancel', {}],
    ['GET', '/api/application/v1/installations/{id}/components', null],
    ['POST', '/api/application/v1/installations/{id}/components/{recordId}:restore', { expectedRevision: 'integer' }],
    ['DELETE', '/api/application/v1/installations/{id}', { requestId: 'string', expectedRevision: 'integer' }],
    ['GET', '/api/xrain/v1/applications/{id}/execution-authorization', null],
    ['PUT', '/api/xrain/v1/applications/{id}/execution-authorization/grants', { permissionIds: 'array' }],
    ['GET', '/api/xrain/v1/applications/{id}/publication-scope', null],
    ['PUT', '/api/xrain/v1/applications/{id}/publication-scope', { mode: 'selected|all', userIds: 'array', departments: 'array', expectedRevision: 'integer' }]
  ]
};

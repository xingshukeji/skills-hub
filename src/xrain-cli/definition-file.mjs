// Version 1 exchange contract: Workforce DOC-0017 and definition-file.ts.
// Keep conversion semantics aligned through the shared synthetic fixtures.
const object = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const text = (v, max) => typeof v === "string" && v.length <= max && !v.includes("\0");
const strings = (v) => Array.isArray(v) && v.every((item) => text(item, 160));
const nullableArray = (v, valid) => v === null || Array.isArray(v) && v.every(valid);
const optionalObject = (v) => v === void 0 || object(v);
const optionalStrings = (v) => v === void 0 || strings(v);
const optionalText = (v) => v === void 0 || text(v, 4096);
function validTool(v) {
  return object(v) && text(v.name, 160) && text(v.description, 4e3) && text(v.serviceId, 160) && text(v.operation, 160) && object(v.parameters);
}
function validQuestion(v) {
  return text(v, 160) || object(v) && text(v.text, 160) && optionalObject(v.when) && (!v.when || ["conversation", "object", "businessSourceId", "objectType"].every((key) => v.when && object(v.when) && (v.when[key] === void 0 || text(v.when[key], 160))));
}
function validAction(v) {
  return object(v) && text(v.businessSourceId, 160) && text(v.objectType, 160) && ["read", "create", "edit"].includes(String(v.action)) && optionalStrings(v.createFields) && optionalObject(v.when) && (!v.when || ["conversation", "object"].every((key) => object(v.when) && (v.when[key] === void 0 || text(v.when[key], 160))));
}
function validView(v) {
  if (!object(v) || !text(v.id, 160) || !text(v.label, 160) || !["list", "detail", "create", "extension"].includes(String(v.kind)) || !optionalStrings(v.fields) || !optionalText(v.listViewName) || !optionalText(v.extensionId) || !optionalObject(v.parameters) || !optionalObject(v.fieldExtensions) || v.inlineEditable !== void 0 && typeof v.inlineEditable !== "boolean") return false;
  if (v.groups !== void 0 && (!Array.isArray(v.groups) || !v.groups.every((g) => object(g) && text(g.id, 160) && text(g.label, 160) && strings(g.fields) && (g.columns === void 0 || g.columns === 1 || g.columns === 2) && (g.initiallyExpanded === void 0 || typeof g.initiallyExpanded === "boolean")))) return false;
  if (v.related !== void 0 && (!Array.isArray(v.related) || !v.related.every((r) => object(r) && text(r.id, 160) && text(r.label, 160) && text(r.objectType, 160) && optionalText(r.relationField) && optionalText(r.listViewName) && optionalStrings(r.fields) && optionalObject(r.through) && (!r.through || object(r.through) && text(r.through.objectType, 160) && text(r.through.parentField, 160) && text(r.through.childField, 160))))) return false;
  return v.actions === void 0 || Array.isArray(v.actions) && v.actions.every((a) => object(a) && text(a.id, 160) && text(a.label, 160) && text(a.extensionId, 160) && optionalObject(a.parameters));
}
function validSidebar(v) {
  if (!object(v) || !text(v.pluginId, 160) || !["always", "conditional"].includes(String(v.availability)) || !optionalObject(v.when) || !optionalStrings(v.allowedOperations) || !optionalObject(v.settings) || ["entryId", "businessName", "initialLabel"].some((key) => v[key] !== void 0 && !text(v[key], 160)) || ["initiallyLoaded", "defaultActive"].some((key) => v[key] !== void 0 && typeof v[key] !== "boolean")) return false;
  if (object(v.when) && (!optionalStrings(v.when.objectTypes) || !optionalStrings(v.when.permissions) || ["conversation", "object", "businessSourceId"].some((key) => v.when && object(v.when) && v.when[key] !== void 0 && !text(v.when[key], 160)))) return false;
  if (v.pluginId !== "xrain-records") return true;
  if (!object(v.settings) || v.settings.objects === void 0) return true;
  return Array.isArray(v.settings.objects) && v.settings.objects.every((item) => object(item) && text(item.objectType, 160) && optionalText(item.listViewId) && optionalText(item.detailViewId) && optionalText(item.createViewId) && optionalObject(item.application) && (!item.application || object(item.application) && text(item.application.applicationId, 160) && optionalText(item.application.path)) && Array.isArray(item.views) && item.views.every(validView));
}
function exportDefinition(value, workspaces) {
  const workspace = value.workspaceDirect ? value.workspacePath ? { kind: "direct", path: value.workspacePath } : { kind: "unavailable" } : value.workspaceId ? {
    kind: "registered",
    id: value.workspaceId,
    ...workspaces.find((item) => item.id === value.workspaceId)?.cwd ? { path: workspaces.find((item) => item.id === value.workspaceId).cwd } : {}
  } : { kind: "none" };
  return { format: "xrain-workforce-agent-definition", version: 1, definition: {
    name: value.name ?? "",
    enabled: value.enabled,
    instructions: value.instructions,
    provider: value.provider,
    model: value.model,
    reasoningEffort: value.reasoningEffort ?? null,
    agentPreset: value.agentPreset,
    workspace,
    nativeTools: value.nativeTools ?? null,
    assistantTools: value.assistantTools ?? [],
    suggestedQuestions: value.suggestedQuestions ?? null,
    businessActions: value.businessActions ?? null,
    uiPlugins: value.uiPlugins ?? null
  } };
}
function readDefinitionFile(value) {
  if (!object(value) || value.format !== "xrain-workforce-agent-definition" || value.version !== 1 || Object.keys(value).some((key) => !["format", "version", "definition"].includes(key)) || !object(value.definition)) throw Error("invalid");
  const v = value.definition, keys = ["name", "enabled", "instructions", "provider", "model", "reasoningEffort", "agentPreset", "workspace", "nativeTools", "assistantTools", "suggestedQuestions", "businessActions", "uiPlugins"];
  if (Object.keys(v).length !== keys.length || Object.keys(v).some((key) => !keys.includes(key)) || !text(v.name, 160) || typeof v.enabled !== "boolean" || !text(v.instructions, Infinity) || !text(v.provider, 160) || !text(v.model, 240) || !(v.reasoningEffort === null || text(v.reasoningEffort, 160)) || !text(v.agentPreset, 160) || !object(v.workspace) || !["none", "unavailable", "direct", "registered"].includes(String(v.workspace.kind)) || v.workspace.kind === "direct" && (!text(v.workspace.path, 4096) || !v.workspace.path) || v.workspace.kind === "registered" && (!text(v.workspace.id, 160) || !v.workspace.id || v.workspace.path !== void 0 && !text(v.workspace.path, 4096)) || !(v.nativeTools === null || strings(v.nativeTools)) || !Array.isArray(v.assistantTools) || !v.assistantTools.every(validTool) || !nullableArray(v.suggestedQuestions, validQuestion) || !nullableArray(v.businessActions, validAction) || !nullableArray(v.uiPlugins, validSidebar)) throw Error("invalid");
  return value;
}
function sameWorkspacePath(left, right) {
  const windows = (value) => /^[a-z]:[\\/]/i.test(value) || /^(?:\\\\|\/\/)[^\\/]/.test(value);
  if (windows(left) && windows(right)) return left.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase() === right.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  return left === right;
}
function definitionFileChanges(file, draft, workspaces, canRestoreInheritance = true) {
  const v = file.definition, warnings = [];
  const changes = {
    name: v.name,
    instructions: v.instructions,
    provider: v.provider,
    model: v.model,
    reasoningEffort: v.reasoningEffort ?? void 0,
    assistantTools: v.assistantTools,
    suggestedQuestions: v.suggestedQuestions ?? void 0,
    businessActions: v.businessActions ?? void 0,
    uiPlugins: v.uiPlugins ?? void 0
  };
  if (v.nativeTools !== null) changes.nativeTools = v.nativeTools;
  else if (canRestoreInheritance) changes.nativeTools = void 0;
  else warnings.push("\u5F53\u524D\u8FD0\u884C\u73AF\u5883\u6682\u4E0D\u652F\u6301\u6062\u590D\u6CBF\u7528\u5DE5\u4F5C\u6A21\u5F0F\u63D0\u4F9B\u7684\u5DE5\u5177\uFF0C\u5DF2\u4FDD\u7559\u73B0\u6709\u9009\u62E9\u3002");
  const w = v.workspace;
  if (w.kind === "direct") Object.assign(changes, {
    workspaceId: null,
    workspaceDirect: true,
    workspaceUnavailable: false,
    workspacePath: w.path,
    agentPreset: v.agentPreset,
    workspaceChange: { operation: "direct", path: w.path, agentPreset: v.agentPreset }
  });
  else if (w.kind === "registered") {
    const match = w.path && workspaces.find((item) => item.id === w.id && item.cwd && sameWorkspacePath(item.cwd, w.path));
    if (match && match.agentPresets.includes(v.agentPreset)) Object.assign(changes, {
      workspaceId: w.id,
      workspaceDirect: void 0,
      workspaceUnavailable: false,
      workspacePath: void 0,
      agentPreset: v.agentPreset,
      workspaceChange: { operation: "bind", workspaceId: w.id, agentPreset: v.agentPreset }
    });
    else warnings.push("\u6587\u4EF6\u4E2D\u7684\u5DE5\u4F5C\u76EE\u5F55\u65E0\u6CD5\u5728\u5F53\u524D\u73AF\u5883\u786E\u8BA4\uFF0C\u5DF2\u4FDD\u7559\u5F53\u524D\u76EE\u5F55\u548C\u5DE5\u4F5C\u6A21\u5F0F\u3002");
  } else if (w.kind === "none" && !draft.enabled) Object.assign(changes, {
    workspaceId: null,
    workspaceDirect: void 0,
    workspaceUnavailable: false,
    workspacePath: void 0,
    agentPreset: "",
    workspaceChange: { operation: "clear" }
  });
  else if (w.kind === "unavailable" || w.kind === "none" && (draft.workspaceId || draft.workspaceDirect))
    warnings.push("\u6587\u4EF6\u6CA1\u6709\u53EF\u7528\u7684\u5DE5\u4F5C\u76EE\u5F55\uFF0C\u5DF2\u4FDD\u7559\u5F53\u524D\u76EE\u5F55\u548C\u5DE5\u4F5C\u6A21\u5F0F\u3002");
  return { changes, warnings };
}
export {
  definitionFileChanges,
  exportDefinition,
  readDefinitionFile
};

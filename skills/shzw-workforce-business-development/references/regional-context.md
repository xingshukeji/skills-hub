# 国际化、日期与时间上下文

产品事实：XRain；公共基础设施由 AiInfra 维护，业务差异由目标项目维护。
维护与适用：本专题由 skills-hub 维护，面向公开能力的业务使用；接口、示例与历史实测的原有适用条件继续有效。内部修改由目标项目入口定位源码与测试。

日期输入、业务日筛选和跨地区展示遵守以下合同；字段类型见[建模](modeling.md)，调度见[自动化](automation.md)。

## 四个不同的值

| 内容 | 含义与写法 |
| --- | --- |
| Date | 日历日期，如 `2026-10-23`；不转换为某个时区午夜 |
| DateTime | 确定时刻，传输须有秒及 Z 或明确 offset；按目标字段的时间合同处理精度 |
| 本地日期时间输入 | 用户输入的当地年月日时分；结合 IANA 地区解析为确定时刻后再写 DateTime |
| 周期安排 | 当地时分与安排自己的 timeZoneId；不是固定 UTC 小时，也不随用户显示偏好漂移 |

按 `temporalContractId` 和 `temporalContracts` 处理精度与格式。业务 DateTime 的 `instant-us-v1` 写查读统一到微秒，输出六位小数 UTC Z；系统时刻和版本值可能有七位。并发条件中的 `updatedAt` 原样回传，不能经仅保留毫秒的 JavaScript Date 往返。

本地化仅影响显示：金额按精确数值合同，选项保存 value；不自动改写日期形状的 Text 或第三方 JSON。

## 从当前身份取得地区设置

`GET /api/service/authen/v1/account/context` 的 `regionalContext` 包含地区值、来源、preferences/defaults、可用时区和显示规则。

实测 Workforce 0.3.8 的 `XRainRuntimeClient.context()` 不保留 regionalContext，需使用完整 HTTP 响应或宿主地区上下文。未配置时，业务时区可为 null、preferences/defaults 可为 `{}`、偏好 GET 可为 404 空正文；不要补造业务地区。

| 属性 | 来源与用途 |
| --- | --- |
| locale | 当前租户用户偏好 → 租户默认 → 平台默认；当前支持 zh-CN/en-US/ja-JP |
| displayTimeZoneId | 同样逐层取默认，用于显示与新建编辑草稿 |
| businessTimeZoneId | 租户显式设置的业务地区，用于业务日和新周期安排；未配置时不猜设备地区 |
| 安排自身 timeZoneId | 已保存安排的地区，后续偏好变化不改它 |

使用支持的 IANA 标识，如 `Asia/Shanghai`。公共组件和自定义编辑器消费 `timeZoneRulesVersion`、`displayTimeZoneRules`，不假定浏览器与服务端规则一致。身份变化时清除旧上下文和绑定草稿；同一身份的已有草稿保留创建时的地区含义。

租户用户偏好用 `GET/PUT /api/tenant/v1/settings/xrain/regionalPreferences`，PUT 使用字符串 value 封装：

```json
{"value":"{\"displayTimeZoneId\":\"Asia/Shanghai\"}"}
```

该特殊键按属性合并：省略保留、null 清除覆盖。租户管理员用 `GET/PUT /api/tenant/v1/settings/regional-defaults` 维护默认，PUT 直接提交 JSON，如 `{ "businessTimeZoneId": "Asia/Shanghai" }`。Host 个人偏好另用 `/api/service/authen/v1/account/regional-preferences`，不覆盖租户设置。

`temporal_preferences_conflict` 时保留输入并重读；上下文损坏时不得静默采用本机时区写入。界面语言不自动翻译自定义标签、邮件和业务文案。

## 把当地输入解析为确定时刻

`POST /api/service/authen/v1/account/temporal/resolve` 一次最多 100 项，key 唯一：

```json
{
  "items": [
    {"key":"visitAt","localDateTime":"2026-11-01T01:30:00","timeZoneId":"America/New_York","temporalContractId":"instant-us-v1"}
  ]
}
```

返回 `{key, utc, errorCode, candidates}` 数组，逐项检查。`temporal_invalid_local_time` 表示当地时间不存在；`temporal_ambiguous_local_time` 时由用户选择 offset 后重新解析；`temporal_offset_mismatch` 表示选择不符。仅保存成功返回的 utc，不自动选首个候选或给无 offset 输入附加 Z。

## 按某地的一个业务日筛选

`POST /api/service/authen/v1/account/temporal/day-range` 接收 `{date, timeZoneId}`，返回 `{startUtc, endUtc}`。DateTime 用 `>= startUtc` 且 `< endUtc`；当地一天可能不满或超过 24 小时，不拼造末尾时刻。

以下将日期范围加入已有条件；`postJson` 为项目的认证请求封装，失败抛错，成功返回解析后的 JSON：

```js
export async function withBusinessDay(query, { field, date, timeZoneId }, postJson) {
  const range = await postJson("/api/service/authen/v1/account/temporal/day-range", { date, timeZoneId });
  if (!range || typeof range.startUtc !== "string" || typeof range.endUtc !== "string") {
    throw new Error("缺少有效的业务日期范围");
  }
  const day = { and: [
    { field, op: "gte", value: range.startUtc },
    { field, op: "lt", value: range.endUtc }
  ] };
  return { ...query, filter: query.filter ? { and: [query.filter, day] } : day };
}
```

例如按上海业务日筛选已完成维修，保留状态/部门条件；人员出差改变显示地区，不改变筛选含义。Date 字段直接筛选日历日期，无需转时刻区间。

周期安排保存自身 timeZoneId，用 schedule preview 检查候选时刻、夏令时和工作日；显示偏好不重写安排。第三方日期按其合同显式转换。

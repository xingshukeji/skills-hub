# 国际化、日期与时间上下文

用于日期输入、按业务日期筛选、跨地区展示和周期安排。字段基本类型见[建模](modeling.md)，调度接入见[自动化](automation.md)。

## 四个不同的值

| 内容 | 含义与写法 |
| --- | --- |
| Date | 日历日期，如 `2026-10-23`；不转换为某个时区午夜 |
| DateTime | 确定时刻，传输须有秒及 Z 或明确 offset；按目标字段的时间合同处理精度 |
| 本地日期时间输入 | 用户输入的当地年月日时分；结合 IANA 地区解析为确定时刻后再写 DateTime |
| 周期安排 | 当地时分与安排自己的 timeZoneId；不是固定 UTC 小时，也不随用户显示偏好漂移 |

运行描述中的 `temporalContractId` 及响应 `temporalContracts` 说明精度与格式。当前业务 DateTime 的 `instant-us-v1` 写查读统一到微秒，输出六位小数的 UTC Z；系统时刻与版本值可能保留至七位。并发条件需要的 `updatedAt` 原字符串应原样回传，不经过只能保留毫秒的 JavaScript Date 往返。

显示本地化不改变值身份：金额/精确数字仍按数值合同处理，选项保存稳定 value，不保存翻译后的 label；日期形状的 Text 和第三方原始 JSON 也不自动当时间改写。

## 从当前身份取得地区设置

`GET /api/service/authen/v1/account/context` 的 `regionalContext` 提供 `locale/displayTimeZoneId/businessTimeZoneId`、各自来源、preferences/defaults、可用时区与显示地区规则。

实测 Workforce 0.3.8 的 `XRainRuntimeClient.context()` 会裁剪返回值，不保留 regionalContext；这里使用完整 HTTP 响应或宿主已加载的地区上下文。未配置时，业务时区可以为 null，preferences/defaults 可以为空对象，用户偏好 GET 可以为 404 空正文；这些不能改写成已配置的默认业务地区。

| 属性 | 来源与用途 |
| --- | --- |
| locale | 当前租户用户偏好 → 租户默认 → 平台默认；当前支持 zh-CN/en-US/ja-JP |
| displayTimeZoneId | 同样逐层取默认，用于显示与新建编辑草稿 |
| businessTimeZoneId | 租户显式设置的业务地区，用于业务日和新周期安排；未配置时不猜设备地区 |
| 安排自身 timeZoneId | 已保存安排的地区，后续偏好变化不改它 |

地区使用实际支持的 IANA 标识，例如 `Asia/Shanghai`，不使用有歧义的 CST 或自造 UTC+8。`timeZoneRulesVersion` 与 `displayTimeZoneRules` 是平台提供的地区规则上下文；支持该协议的公共组件可直接消费。自定义编辑器若自行实现时间显示/编辑，也使用这份已验证规则，不假定浏览器和服务端的时区数据库完全一致。身份变化时清除旧上下文及与其绑定的草稿；同一身份的既有草稿需要保留其捕获的地区含义。

租户用户偏好通过 `GET/PUT /api/tenant/v1/settings/xrain/regionalPreferences` 读写，PUT 仍采用用户设置的字符串 value 封装。例如只改显示地区：

```json
{"value":"{\"displayTimeZoneId\":\"Asia/Shanghai\"}"}
```

该特殊键按属性合并：省略保留、null 清除本层覆盖，不能套用普通字符串设置的整值覆盖语义。租户默认使用 `GET/PUT /api/tenant/v1/settings/regional-defaults`，由租户管理员维护，PUT 直接提交 JSON 变更，例如 `{ "businessTimeZoneId": "Asia/Shanghai" }`。Host 的个人偏好有独立 `/api/service/authen/v1/account/regional-preferences` 入口，不借 Host 偏好覆盖租户设置。

设置冲突如 `temporal_preferences_conflict` 时重新读取并保留本次输入；损坏或不可用的时间上下文不能静默回退到本机时区后写入。界面语言改变也不意味着企业自定义字段标签、邮件正文和所有业务文案自动获得翻译。

## 把当地输入解析为确定时刻

使用 `POST /api/service/authen/v1/account/temporal/resolve`，一次最多 100 项且 key 唯一。例如把表单的本地时间按指定地区解析：

```json
{
  "items": [
    {"key":"visitAt","localDateTime":"2026-11-01T01:30:00","timeZoneId":"America/New_York","temporalContractId":"instant-us-v1"}
  ]
}
```

响应是按 key 标识的 `{key, utc, errorCode, candidates}` 数组，不能仅凭 HTTP 成功就写入。当地时间不存在时返回 `temporal_invalid_local_time`；有两个候选时返回 `temporal_ambiguous_local_time`，让用户选择有实际含义的 offset，再附 `offset` 重新解析。`temporal_offset_mismatch` 表示选择与地区规则不符。成功后保存服务端给出的 utc；不自行选第一个候选或把无 offset 字符串附加 Z。

## 按某地的一个业务日筛选

`POST /api/service/authen/v1/account/temporal/day-range` body 为 `{date, timeZoneId}`，返回 `{startUtc, endUtc}`。用半开区间 `>= startUtc` 且 `< endUtc` 筛选 DateTime；当地一天可能不是 24 小时，也不应拼造 `23:59:59.999` 作为末尾。

下面的业务辅助函数把日期范围加入已有查询条件。`postJson` 是项目现有的认证请求封装，失败时抛错，返回已解析的 JSON；不是另一个平台 SDK 方法。

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

例：“查看上海业务日的已完成维修”采用租户业务地区生成日期范围，并保留原状态/部门条件；出差人员可以按自己的显示地区查看各条完成时刻，筛选的业务日期含义不改变。如果筛选字段本身是 Date，则直接使用日历日期条件，不走时刻区间转换。

创建 Routine 等周期安排时明确安排使用的 timeZoneId，并用目标 schedule preview 查看实际候选时刻、夏令时和工作日结果；显示偏好不重写已保存安排。平台地区设置、周期计划和外部系统日期约定各自有含义，接入第三方时显式转换其合同。

# 从项目源码发布和测试函数

函数定义、实现及合同由业务项目维护，CLI 复用 `xrain-project.json` 的 `tenantFunctions` 和共用组装器。发布只处理项目函数来源和版本，不修改应用选版、宿主配置或业务记录。

```text
xrain-cli project function publish --project <项目目录> --key <tenant.函数名称> --profile <目标连接> --auth session
xrain-cli project function test --project <项目目录> --key <tenant.函数名称> --version-id <发布回执版本ID> --cases tests/function.cases.json --profile <目标连接> --auth session
```

先用同一连接的 `auth whoami --auth session` 核对目标和主体。两项命令均使用保存的租户登录会话，不使用 API Token 或 Host 身份。模块源码按项目锁定的 esbuild 组装；`publish --release` 还要求全部项目输入已提交。

发布读取当前项目源码，保存独立函数输入及来源快照，再按精确 key 查找本租户函数。不存在时创建；存在且定义不同时默认停止。提示明确列出平台、租户、函数名称和 key；`differences` 中的 `current` 是目标现值，`project` 是本地项目值。名称、说明、签名和启用状态显示前后值；源码显示摘要、字节数、行数及首个不同行号；合同逐路径显示前后值或缺失标记。提示明确声明本次未向平台写入。先核对并将应保留的租户修改归入项目，再用 `publish --update` 用本地项目定义更新目标租户中的同一来源，随后创建或复用匹配版本；应用选版、宿主配置和业务记录保持原值。启用状态也采用项目值；停用会使已关联应用的当前调用不可用，旧不可变版本的内容保持原值。源码和合同相同的已有不可变版本直接复用，否则创建新版本并核对返回内容。回执提供 `functionId`、`versionId`、源码及合同摘要和本次输入路径。发布不会创建应用关联或选择版本，采用版本仍走既有 `application function set`。

写入未知时保留原错误、函数 key、已知 ID、阶段和本次输入位置。先用同一目标的 `function list` 和 `application function versions <functionId>` 回查，不盲目重发创建。版本被并行修改的来源污染时返回失败并保留已创建的版本 ID，不报告为本项目版本，不自动改回他人的来源。

用例文件相对项目根解析，也接受明确的绝对文件路径：

```json
{"schemaVersion":1,"cases":[
  {"name":"明确零金额","input":{"amount":"0"},"expected":{"status":"ready","amount":"0.00","questions":[]}}
]}
```

`name` 不重复；每例必须有 `input` 和 `expected`，`expected` 不能是空对象。对象按指定字段递归核对，数组长度及对应项、标量值和类型精确核对；数字文本不转成浮点数。缺字段也返回断言失败，金额期望应来自业务规则。

测试先确认版本属于该 key 对应的函数，再顺序执行现有指定版本试算接口。`matchesProject` 表示被测版本与当前项目源码及合同是否一致；为 false 时仍可测试明确指定的历史版本。回执含每例通过状态和失败差异；有断言失败返回非零退出码。请求或权限失败时停止后续用例并保留已完成结果，不自动重试。

受保护 `tenant.sealed.*` 版本沿平台纯执行入口，不提供 SDK。普通函数仍按原平台合同执行，可能产生 SDK 副作用，测试前须核对用例及授权；CLI 不把普通函数伪装成纯函数。测试不发布新版本，不修改应用选版。

先运行项目本地测试，再用本次发布版本执行合成用例，最后验证原用户的页面或智能体调用。函数试算通过不代表应用已选用、宿主已接入或报价已保存。

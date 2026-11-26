# 调用与参数

`<模式目录>` 指本技能目录下的 `modes/pipeline`，不是目标项目目录。

Node.js 22.12+，脚本随 skill 独立运行：

```text
node "<模式目录>/scripts/jenkins.mjs" jobs --url <Jenkins>
node "<模式目录>/scripts/jenkins.mjs" inspect --job <作业> --url <Jenkins>
node "<模式目录>/scripts/jenkins.mjs" trigger --job <作业> --parameters-file "<参数.json>" --run-file "<新回执.json>" --url <Jenkins>
node "<模式目录>/scripts/jenkins.mjs" status --run-file "<本次回执.json>"
```

jobs 支持 --job 查询目录；status 也支持 --job/--build/--url 定位既有构建。地址可用 JENKINS_URL；沿目标已配置的 HTTP 或 HTTPS 入口，不另行施加协议策略。JENKINS_USER/TOKEN 从原秘密入口注入，脚本不直接读取 PowerShell CredentialRef。

参数为 JSON 对象，值为字符串、数字或布尔；无参数可省略文件。回执放私有工作目录，后续复用。completed 还须检查 result；queued/running 继续跟踪，cancelled/unknown/submission-result-unknown 不算成功。无 queue ID 的未知提交须查项目队列/构建记录，重复 status 不会补出关联，不能重发。

## 目标作业合同

作业名称、来源分支、提交选择规则、参数及触发方式由责任项目的当前 Runbook 与 `inspect` 返回共同确定；技能不登记具体环境和作业。执行前核对参数对应的实际动作及当前授权，不能从作业名称推定用途，也不能沿用另一项目的参数。

源码获取、Job 配置及目标策略由责任项目维护。报告按本次实际请求核对来源、制品及操作结果；构建成功不证明后续操作已经发生。

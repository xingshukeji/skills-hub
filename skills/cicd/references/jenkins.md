# 调用与参数

Node.js 22.12+，脚本随 skill 独立运行：

```text
node "<skill目录>/scripts/jenkins.mjs" jobs --url <Jenkins>
node "<skill目录>/scripts/jenkins.mjs" inspect --job <作业> --url <Jenkins>
node "<skill目录>/scripts/jenkins.mjs" trigger --job <作业> --parameters-file "<参数.json>" --run-file "<新回执.json>" --url <Jenkins>
node "<skill目录>/scripts/jenkins.mjs" status --run-file "<本次回执.json>"
```

jobs 支持 --job 查询目录；status 也支持 --job/--build/--url 定位既有构建。地址可用 JENKINS_URL；要求 HTTPS，回环测试可用 HTTP。JENKINS_USER/TOKEN 从原秘密入口注入，脚本不直接读取 PowerShell CredentialRef。

参数为 JSON 对象，值为字符串、数字或布尔；无参数可省略文件。回执放私有工作目录，后续复用。completed 还须检查 result；queued/running 继续跟踪，cancelled/unknown/submission-result-unknown 不算成功。无 queue ID 的未知提交须查项目队列/构建记录，重复 status 不会补出关联，不能重发。

## XRain 已登记手动作业

先 inspect 当前 Job；以下为已核对的契约，不替代运行态查询：

| 目标 | 参数 |
| --- | --- |
| 只检查 | CHECKS_ONLY=true |
| 构建发布 | CHECKS_ONLY=false，DEPLOY_TEST=false（有此参数时） |
| 已开放的部署 | CHECKS_ONLY=false，DEPLOY_TEST=true |

SOURCE_BRANCH 仅 main；EXPECTED_COMMIT 留空取最新已推送提交，填写完整 SHA 是分支尖端相等断言，不能选择历史版本。核心的 HARNESS_BRANCH/HARNESS_EXPECTED_COMMIT 同理。检查、镜像、发布与部署使用本次同一来源快照；失败不回退旧候选。NEGATIVE_CHECK 默认关闭。

workforce-core-test-ci 当前只准入 TEST_INSTANCE=v2-public；workforce-mail-test-ci 无部署入口。anbang-sales-test-ci 的新企业宿主制品不能套用旧 V3 三服务部署。test 命名不能代替环境用途：V2/V3 为演示，研发在本机。实际部署仍须目标策略开放并覆盖本次授权。

源码认证中继、Job/候选模板及策略由责任项目维护；日常调用不自行搭建转发或修改它们。Git push 不自动触发这些作业。报告分别核对 source、publication、deployment；历史成功和单次准入豁免不能沿用为当前依据。

# 本地打包隔离审查

只读审查当前目录的实现。ProductContract.md 定义打包合同，app.mjs 提供公开入口。已有检查为 `node --test smoke.test.mjs`。不执行发布、不访问真实仓库或网络、不写 Git、不自行委派。技能目录由任务提供。

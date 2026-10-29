# 公共 npm 包发布

本模式用于产品已构建的 npm tarball 发布到 Nexus Raw。发布工具在本技能的 `scripts/publish-package.py`，仅需要 Python 3.10+ 标准库。完整目录复制到任意安装位置即可运行，不读取 skills-hub 或 xrain-cicd 源码，不要求消费项目。

## 选择操作

- 查询或本地预检：读取产品发布声明和原包摘要，不访问网络，不读取发布凭据，不登记已交付版本。
- 发布新版本：由责任项目显式定版、构建和验证原包。核对原包的来源和对应输入已提交、推送，再固定版本、SHA-256 和目标地址。发布成功后才更新消费者依赖。
- 补传已锁定的缺包：复用原 tarball，额外核对原消费锁的版本和 integrity。不得重建同版本或改锁来掩盖不同字节。既有 CI 补传入口可以继续使用。

## 固定发布凭据

团队共享 Nexus `https://nexus.atlas-xrain.com/` 的应用公共包统一复用既有程序账号 `applications-ci-publisher-v1`。成员和 CI 使用同一受管发布凭据，无需另建或提供个人 Nexus 账号。这个账号虽包含 `ci`，也供本技能的直接发包入口使用。

从[服务产品主台账](https://icnqubijerds.feishu.cn/base/EtKrbZtXlaH2m0si7bgcVn5bnZg)按下列关系读取。密码只保存在密码字典的 `value` 字段，技能只分发账号和查找键。

| 位置 | 查找内容 |
|---|---|
| 账号清单 | “Nexus · 应用包制品发布”；登录账号 `applications-ci-publisher-v1`；凭证Key `acct.nexus-applications-ci-publisher-v1` |
| 密码与密钥 | `key` 精确等于 `acct.nexus-applications-ci-publisher-v1`；读取该记录的 `value` |
| 允许的公共包路径 | `versioned-releases` 下的 `workforce-application/releases/`、`xrain-agent-runtime/releases/`、`record-file/releases/` |

1. 使用当前可用的多维表格工具读取账号清单、密码字典的字段和上述记录。按 `凭证Key` 与 `key` 关联，不用账号说明中的关键词搜索代替密码字典查询。
2. 确认 `key` 完全匹配且 `value` 非空。“已收录”只是登记状态，不能代替实际字段检查。查询没有返回记录时，先核对 Base、表、字段和分页；只有完整查询后才能报告缺项。
3. 将账号和密码在内存中注入发布进程的 `XRAIN_NEXUS_PUBLISH_USER`、`XRAIN_NEXUS_PUBLISH_PASSWORD`。读取结果和子进程环境不得打印；工具生成临时秘密文件时，限定当前用户访问，并在读取后清除。

台账不可读或实际缺值时，报告具体资源、key 和访问或收录缺口，按原受管身份恢复；不把缺口转成索要个人 Nexus 账号的前提。该账号的允许路径不扩大到其他项目。其他包源或路径使用目标 Runbook 登记的发布身份。发布权限由目标 Nexus 校验；权限不足时报告对应 HTTP 状态，不切换到管理员绕过。

发布工具接受上述两个进程环境变量，不读取 CI 私有文件，也不把凭据写入命令参数、输出、回执或 Git。仅查询或本地预检时，跳过本节的凭据读取。

## 产品入口

先读责任项目 Runbook。产品拥有 `scripts/package-publication.json` 中的包身份、正式发布路径、构建元数据及交付登记位置。产品的发布命令通过 `--publisher` 或 `XRAIN_PACKAGE_PUBLISHER` 显式选用本技能工具；路径指向已安装的文件，不需要技能源码仓库。

从产品根目录运行产品 Runbook 中的发布命令。工具也支持直接调用：

```text
python <已安装技能>/scripts/publish-package.py --project <产品根目录> --package <原包.tgz> --expected-sha256 <构建记录的摘要> --evidence-directory <本次证据目录>
```

预检输出 `prepared: true`、包身份、固定发布 URL 和 integrity。核对它们与本次用户授权一致。已有明确授权覆盖相同原包及目标时直接继续；预检成功不自行产生发布授权。

仅在用户已授权实际发布时，在同一命令增加 `--execute --authorization-ref <当前用户授权来源>`。采用 Workforce 共同工作流的项目按已有 Deployment 要求绑定原包、目标及恢复边界；不把运行环境部署或广泛系统测试加为单独发包的前提。需要额外比对已固定的 SHA-512 时传入 `--expected-integrity`。产品命令和配置的实际名称、版本、来源和摘要从责任项目读取，不从示例猜测。

## 结果与恢复

工具先匿名读取固定地址。远端不存在时上传原字节；存在相同字节时复用；不同字节时拒绝覆盖。上传后再次匿名逐字节回读，成功后才原子更新产品声明指定的已交付 integrity，并保存 `publication.json`。调用方保留原 tarball，再按消费者的正常包管理器入口更新依赖和验证下载。

写入开始后的失败保留 `started-result-unknown`。使用同一原包和证据目录查询原地址；远端已有原字节时允许恢复成功回执。已有开始记录且远端仍缺包时停止，不自动重发。登记失败但远端原包已存在时，沿同一证据目录回读并补登记，不重新上传。新版本没有需要恢复的旧包；错误包保留现场，按新版本前向修正，不覆盖或删除既有包。

构建或发布包不改变服务器运行版本。报告原包、目标、匿名回读、交付登记和后续消费者验证的实际结果；不要用工具测试通过宣称真实发布权限或正式发布已经验证。

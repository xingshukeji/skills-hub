---
name: shzw-delivery
description: 发布责任项目的公共包，或查询和执行已有流水线、部署及回滚。团队 Nexus 公共包复用台账中的固定发布凭据，无需个人 Nexus 账号或 CI 仓库；真正发布或部署沿用明确制品、目标与授权，构建和 Git 推送不自动授权发布。
metadata:
  maintainer: 苏州苏宏助为智能科技有限公司
  source: https://github.com/xingshukeji/skills-hub/blob/main/skills/shzw-delivery/SKILL.md
  documentation: https://xingshukeji.github.io/xrainTrain/developers/skills
  products: XRain 项目交付
---

# 包发布、流水线与交付

先区分查询、构建、发布和目标部署，以当前请求及必要前文固定项目、操作、制品和目标。查询状态不建立部署任务；未知提交结果先查原 queue/build，不用最新记录或再次触发代替。

先按制品类型找到责任项目的入口及 Runbook。团队共享 Nexus 的公共 npm 包按包发布模式复用台账登记的固定发布账号及允许路径；执行者从受管台账读取凭据，不要求成员提供个人 Nexus 账号。直接发包不要求 Jenkins 或 xrain-cicd 仓库权限。需要执行流水线时再读取其登记，源码获取与构建交给原流水线。Jenkins 工具需要 Node.js 22.12+；本技能的 npm Raw 发布工具仅依赖 Python 3.10+ 标准库。

当前平台按交付对象选责任入口：公共 npm/NuGet 包核对产品声明、原包与目标包源；新版本发布后再更新实际消费者，只有补传已锁定的缺包时才要求原消费锁。`.appkg` 由应用项目持有源码和制品，目标 XRain 提供统一构建与安装，独立应用市场按其能力负责发布和分发。业务服务和客户端沿自己的构建 Runbook。xrain-cicd 负责已有 Jenkins 编排；部署目标、Nexus/网关等设施及其入口由对应纳管项目维护。不要把 npm 包、应用包、镜像和客户端安装包当成同一种制品，也不把某客户端的固定 OSS 发布规则套到整个工作空间。

核对流水线参数对应的真实阶段：CI 产生的制品、CD 选择的同一制品、目标实际运行版本必须能对应。检查当前配置的 HTTP 或 HTTPS 入口，不由辅助脚本另行强制升级协议；凭据、作业及原运行身份校验继续保留。

真正发布或改变命名目标时，核对当前明确授权、确定制品、准入证据、回滚和最小后置检查。按目标 Runbook 执行，不现场改代码或替换制品，不因缺证据自动建立独立测试。构建成功、制品存在、目标进程正常及业务可用分别报告。

首次交付沿原作业和目标读到实际终态，给出来源、制品、部署或回滚结果与证据边界。

## 按需资料

- [用固定发布凭据发布公共 npm 原包，或补传已锁定的缺包](modes/package/GUIDE.md)
- [读取作业参数、触发已有阶段和跟踪原 queue/build](modes/pipeline/GUIDE.md)
- [将一个确定制品发布到命名目标或按原授权回滚](modes/deployment/GUIDE.md)

按需读取命中资料。项目源码、命令和收口遵循目标项目入口；技能自身资源相对本目录解析。

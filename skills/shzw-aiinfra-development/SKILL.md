---
name: shzw-aiinfra-development
description: 使用或维护 AiInfra.Abp.* / LLM_backend_packages 开发 .NET 后端，处理新项目、公共能力复用、DI、Repository/Manager/AppService 分层、事务、数据访问、CPU/内存/IO 优化、动态代码执行与 provider 边界。代码缺陷审查可按需读取此知识。
metadata:
  maintainer: 苏州苏宏助为智能科技有限公司
  source: https://github.com/xingshukeji/skills-hub/blob/main/skills/shzw-aiinfra-development/SKILL.md
---

# AiInfra 后端开发

先识别当前责任项目：AiInfra 拥有公共基础设施，产品拥有业务规则及用例。读取已交付公共 API、包文档和目标项目入口；只有修改平台或公共包时才进入其源码与内部测试。安装位置不决定源码位置。

沿本次请求追踪 HTTP、AppService、领域操作、Repository、provider 及真实消费包，只展开实际到达的层。优先复用公共能力，必要时保留薄适配或在上游补足；不要将产品专用字段、SQL 片段或 provider 类型放入中立合同。

先确定公共 API、DTO、权限、schema 和事务变化影响谁，再修改相应所有者。首次验证覆盖原路径及受影响缺省分支；真实库用于证明事务、provider 或持久化语义，测试替身不代替它。公共包通过后还须验证实际包消费者，不能以源码通过声称旧包已生效。

实施资源或性能优化，或当前规模暴露重复计算、序列化和数据访问代价时，读[.NET 后端优化](modes/performance/GUIDE.md)。从实际热点选择算法、批量、编码与缓冲，保持职责、状态和正常路径清楚；在业务结果和维护成本相当时选择较直接的实现。首次交付验证原反例及相关正常、失败和恢复行为，不让测试期望跟随新实现自动改变。

普通实现附带验证保持 Development；独立系统测试或发布部署沿各自明确授权执行。

## 按需资料

- [新建后端且需要现有脚手架](modes/initialize/GUIDE.md)
- [现有应用复用、事务与动态代码执行](modes/reuse/GUIDE.md)
- [处理后端分层、DI 和公共包职责](modes/boundaries/GUIDE.md)
- [优化 CPU、内存、JSON 与数据库 IO](modes/performance/GUIDE.md)

按需读取命中资料。项目源码、命令和收口遵循目标项目入口；技能自身资源相对本目录解析。

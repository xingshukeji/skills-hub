---
name: shzw-xrain-code-review
description: 审核 XRain 前后端、diff 或 PR；项目级审核追踪完整调用链，重复审核自动反思并补查。不用于纯方案评审。
metadata:
  maintainer: 苏州苏宏助为智能科技有限公司
  source: https://github.com/xingshukeji/skills-hub/blob/main/skills/shzw-xrain-code-review/SKILL.md
---

# XRain Code Review

Resolve project entrypoints, source, documents and command working directories from the user's target project. Resolve this skill's `references/`, `scripts/` and `assets/` from its installed directory. Locate other responsible repositories through the target project's entrypoint; never infer the target from the skill installation path.

按用户范围审核；项目级审核看当前实现，不缩成 diff。未指定范围时取明确的 XRain diff。产品 review 只读，修复须有授权；本 skill 的反馈改进见下文。

## 依据

从 项目入口（目标项目的 `文档/项目/项目_XRain/AGENTS.md`）按能力读取契约，遵守 源码入口（目标项目的 `XRain/AGENTS.md`）。研发边界查 DOC-0009（目标项目的 `文档/工作空间/技术设计/DOC-0009-研发实践与Review基线.md`），语言规则查 DOC-0010（目标项目的 `文档/工作空间/技术设计/DOC-0010-技术栈与语言规范.md`）；UI、条件组件、AiInfra 分别由项目入口路由。只读命中内容，外部通用规则不替代项目契约。

## 审核

- 首轮就按能力和不变量枚举实际入口与消费者，再追踪身份、业务判断、数据/副作用及用户反馈；不以 diff 文件名、模块后缀或首轮发现清单代替调用方清单。核对接口、实现、配置和已有保护，包括删除代码造成的保证丢失；同根因的旁路在本次审核内查完，不留待用户再次要求。
- 恢复与隔离按每个持久化点的前后状态核对：尚无尝试记录、进行中、已成功但后置条件未完成、失败、取消或进程中断、再次重试。成功标记不是完整后置条件；恢复键和身份须贯通实际调用方，迟到成功也不能复活已失效身份。异常边界覆盖单项读取、执行及结果持久化，并检查失败项之后的健康项。
- 编码、转义、格式转换或传输修复须串起生产者与实际消费者，验证一次往返及相邻歧义输入；不能分别证明两端符合局部断言就宣称链路成立。
- 用真实所有者校准测试替身：保存默认值、状态/租约、列长和空值约束不能由 mock 自行定义。修复后既验证原触发路径，也验证受影响的缺省分支；源码通过与实际消费包生效分别举证，不用旧包或替身测试覆盖后者。
- 项目级审核与重复审核的独立补查使用新上下文子代理，固定 `gpt-6-astra` / `low`，不递归委派。按完整链路分工，允许重叠读取；主代理负责跨链路调查与整合。局部简单 review 不强制委派；配置不可用则报告缺口，不静默替换。
- 子代理返回检查范围、原始证据、已排除疑点及反证、未闭合链路。及时保留发现，失败不能丢失已有结果；补查不受首轮疑点清单限制。
- 缺陷必须有触发条件、实际影响和责任位置。撤销发现须有反证；上下文不足或复核失败列为待定位，不算确认缺陷。保留关键符号、原始片段和已有保护，不猜行号。
- 对“缺项、过滤过度、目录不全”的判断，先核对对应 CurrentDesign 的有意隐藏、继承和只读边界，区分执行/授权事实与界面候选；至少核对一个应保留项和一个应排除项。报告须指明违反哪条边界，修复不能靠扩大目录或取消降噪使局部用例通过；若设计未区分两者，在能力唯一所有者补清，而不从当前过滤代码反推产品意图。
- 风格偏好、helper 差异、类名或依赖声明不直接判缺陷；合理薄适配与项目允许的例外不机械收敛。包问题区分平台、包内容和正常运维责任。
- 充分静态证据可成立；需要时做定向验证，不靠重启服务或扩大测试凑证据。

## 重复请求：反思并继续

审核交付后，用户再次要求相同或重叠范围的审核，自动执行；解释既有问题、询问进度不触发，无新请求不后台运行。

1. 定向恢复相关会话的范围、版本、结论、证据和缺口，核对当前变更。历史不可得则说明，不推断漏审。
2. 针对覆盖遗漏、浅查链路、错误假设/过滤或过早收口开展补查，复用有效证据。不得为验证 skill 回退版本、盲测或回放历史 PR，除非用户另行要求。
3. 新发现区分原版本漏审、修复引入、新变更、此前证据不足；可读 Git 差异归因。重复提问不是漏审证据，不凑问题。
4. 有可复用的方法缺陷时，用户已授权按 [工作流演进](https://github.com/xingshukeji/skills-hub/blob/main/skills/shzw-evolve-document-driven-workflow/SKILL.md) 和 [文档治理](https://github.com/xingshukeji/skills-hub/blob/main/skills/shzw-document-governance/SKILL.md) 更新本 skill 及直接路由并校验；无缺陷不改。不扩改产品、契约或根门禁，不堆个案规则或保存复盘报告。效果由后续真实审核反馈检验。

## 完成与输出

按实际范围保留覆盖和缺口；逐项闭合已枚举入口、关键状态转换与后置条件，确证问题有归属，反证可核验，剩余缺口明确。有已知、可执行的关键调查就继续，不等用户追问。用户已授权修复并复审时，同范围新缺陷在本次任务内修复和定向复验；只读审核仍不修改产品。发现数量、读完文件、子代理结束、固定轮数或连续零发现均不是完成标准，也不承诺零缺陷。

按影响合并同根因，报告：分类、文件/行号、触发与影响、依据、责任方、最小建议。区分缺陷、建议、未验证项；重复审核补充归因及方法变化。给范围内通过/不通过与证据，关键证据不足不能称通过。不自动修复产品、建立 SystemTest 或落盘审核报告。

方法参考：[跨文件与发现保留 #808](https://github.com/alibaba/open-code-review/pull/808)、[原始证据定位 #921](https://github.com/alibaba/open-code-review/pull/921)、[过滤失败保留 #1065](https://github.com/alibaba/open-code-review/pull/1065)、[上下文与合法例外 #1061](https://github.com/alibaba/open-code-review/pull/1061)；无需每次重读。

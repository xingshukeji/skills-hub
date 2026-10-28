---
name: shzw-solution
description: 制定、比较或评审技术方案，解决目标、职责或验收的实质分歧。普通实现、修复、恢复前文、补查事实和例行选择沿原任务执行，不重新规划。
metadata:
  maintainer: 苏州苏宏助为智能科技有限公司
  source: https://github.com/xingshukeji/skills-hub/blob/main/skills/shzw-solution/SKILL.md
---

# 方案制定与评审

让方案能直接指导当前业务实施。项目事实与文档位置从目标项目入口确定；使用产品公开能力时读取交付知识和 API，不要求私有源码。

先识别本轮结果：理解需求、讨论选择、交付方案、质疑已有方案或实施。用户说“先理解”时只说明目标、保留条件、关键分歧与依据；后续明确“请执行”就进入已批准范围，不再次交付同一方案等用户催动。

用户确认已有工作时，又问某个新增方法、技能或依赖“是否应该这样”，先把已授权结果与仍待判断的建议分开。针对建议核对实际用途、现有所有者、必要性和反例，给出有依据的判断；不要把问句当作新决定。用户要求“先质疑”时先完成只读评价；已授权且不依赖该选择的工作可在不冲突时继续。

沿前文保留已确认的选择，并对照新要求标出变化。质疑可能是纠正事实、收敛设计或改变目标；先查当时要求及当前证据，不自动赞同，也不把所有改口解释成旧方案有错。只暂停真正影响方向或授权的未决选择，能查证的材料自己查。

从原用户操作走到持久结果和下一步使用，找实际能力与消费者。新增表、服务、状态或编排机制时，说明现有能力为什么不足，以及它保存哪个独立事实、由谁维护。没有独立事实和当前消费需求时不新建一层；通用思想可以复用，其他业务的表与实现不能直接套用。

涉及业务对象、字段、历史事实或 E-R 图时，按[业务建模方法](https://github.com/xingshukeji/skills-hub/blob/main/skills/shzw-workforce-business-development/references/modeling.md)核对材料来源、记录粒度、代码匹配与真实关联、字段覆盖和计算样例。优先读取已安装的同名专题，绘图工具只负责表达。首次方案和评审都要做语义核对；不能只检查图能否渲染，也不把新增建议直接画成已确认需求。

先按平台能力决定要改什么，再比较实现方案：

| 业务需要 | 先核对的能力与实际选择 |
|---|---|
| 保存新业务事实、负责人、协作与追溯 | XRain 对象、字段及已有 Owner、分享、历史；缺的是业务字段或授权时配置现有能力，不再建一套人员、分享或审计表 |
| 操作已有 ERP、CRM 或其他系统 | 原系统仍保存事实；用 Connector、请求及必要的 Routine 组合，只有独立新事实才建对象 |
| 增加页面、工具或应用 | Workforce 公共 SDK 的宿主、客户端入口及 Runtime 工具能力；区分企业业务代码与公共能力缺口，不用平台私有导入补接口 |
| 定时或事件驱动处理 | 已有函数、Trigger、Routine 及对应执行入口；确认触发条件、执行身份、重复处理和结果去向，不因存在按钮就另建调度器 |

公开使用细节按需查企业业务技能的[对象能力](https://github.com/xingshukeji/skills-hub/blob/main/skills/shzw-workforce-business-development/references/object-foundation.md)、[集成](https://github.com/xingshukeji/skills-hub/blob/main/skills/shzw-workforce-business-development/references/integration.md)或[SDK](https://github.com/xingshukeji/skills-hub/blob/main/skills/shzw-workforce-business-development/references/workforce-sdk.md)。对目标租户、已安装包与实际版本核对支持情况；“平台能做”“该项目已配置”“原使用者已能完成”是三个不同结论。

涉及界面时，从使用频率、内容复杂度、编辑与预览、保存回读和再次进入决定交互，复用当前组件。只展示用户需要判断和操作的业务信息；技术职责和排除项留在方案，不转成页面提示。

按目标项目规则交付方案或实施。方案应把实质选择、最小改变、消费者、失败行为和验证依据讲清；普通明确实现只需要与风险相称的工作计划。方案已足够执行时继续完成授权工作。

## 按需资料

- [目标、边界、事实或验收存在实质未决选择](modes/direction/GUIDE.md)
- [请求方案交付，或受控实现需要工作计划](modes/design/GUIDE.md)
- [用户要求质疑或审查一个已有方案](modes/challenge/GUIDE.md)

按需读取命中资料。项目源码、命令和收口遵循目标项目入口；技能自身资源相对本目录解析。

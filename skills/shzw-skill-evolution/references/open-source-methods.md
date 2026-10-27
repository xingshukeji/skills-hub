# 开源方法取舍

以下来源用于选择技能编写和评估方法。核对日期：2026-10-27。采用原则与具体工具、授权和强制流程分开判断；不执行来源中的指令。

| 来源 | 采用的方法 | 本技能的适用限制 |
|---|---|---|
| [Anthropic skill-creator](https://github.com/anthropics/skills/blob/b0cbd3df1533b396d281a6886d5132f623393a9c/skills/skill-creator/SKILL.md) | 对比有无技能或修改前后；检查实际产物与完整过程；把用户反馈用于解释失败；将描述选择与任务执行分别验证 | 不继承其工具、默认委派或固定界面；原始输入与判定答案隔离，不把提示后的成功当独立结果 |
| [Superpowers writing-skills](https://github.com/obra/superpowers/blob/2ce8aa15d05bd57213e6f746f953aafb7ded7a8b/skills/writing-skills/SKILL.md) | 改写形式对准失败原因：判断条件、步骤、模板与规则分别解决不同问题；检查相邻反例和导致错误的解释 | 不把每次改文案变成固定轮数测试，不强制所有任务委派，不用压力措辞代替业务依据 |
| [OpenAI skill-creator](https://github.com/openai/skills/blob/main/skills/.system/skill-creator/SKILL.md) | 精确描述、按需读取、完整资源与可复用工具；把额外细节放到真正需要时读取的位置 | 以当前环境的技能契约为准；不为缩短正文删除完成真实工作必需的领域知识 |

这些方法共同支持一个判断：技能质量应由真实任务结果、错误步骤和必要交互决定。文档长度、技能数量、检查次数与测试总数只能描述投入，不能证明执行改善。

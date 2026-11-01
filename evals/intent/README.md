# CLI 技能意图 A/B 评估

本评估比较技能描述与入口正文对意图判断的影响。模型只判断目标系统、主技能、业务动作、已知限制和下一步。评估器不提供业务工具，不连接 XRain、Workforce 或认证中心，不证明命令执行或业务结果正确。

## 输入与判定

`development-cases.json` 用于开发。`holdout-cases.json`、`final-cases.json` 与 `acceptance-cases.json` 是前三次留出题，均暴露失败并参与后续优化，不能继续称为未见题。`regression-cases.json` 包含开发题及四项留出失败，共16题。`verification-cases.json` 在最新候选冻结后编写，用于第四次留出检验；以后修改技能时它也是已见回归材料。

每组案例仅包含自然请求与当时已知前文。对应的 `*-rubric.json` 留在评判侧，不进入模型请求。允许的多个答案表示合法的意图或方法选择；不能在看过某轮结果后改写该轮冻结判定。修改口径后另建运行目录，保留旧结果。

评估器固定以下步骤：

1. 向模型提供当前案例及技能目录，记录第一次判断。
2. 按模型所选名称提供该条件的冻结 `SKILL.md`，要求校核判断。主技能变化时提供新选入口，最多六轮。
3. 将最终结构化答案与六项判定字段比较。首次判断另计主技能、动作、CLI 适用性和是否澄清四项。
4. 人工审阅 `next_step`，核对它是否与结构化答案一致，是否误称已经执行，以及是否提出越权、重复提交或忽略原成功部分的动作。自动成绩不能替代这一步。

各题、各条件和各次重复均使用独立上下文。模型不接收 A/B 标签或另一条件的答案。相邻配对按 A/B、B/A 交替，减少先后与缓存差异。两个目录必须具有相同技能集合，除被测 CLI 技能外保持相同内容；准备时由维护者核对完整目录指纹。程序不在产品运行时参与技能路由。

交付前若其他技能入口变化，保持CLI候选不变，在两组同时更新这些入口后另跑兼容复验。保留原检验成绩；复验同题不算新增未见题，也不能把不同目录的成绩直接合并。

`readiness` 描述案例中的目标动作。明确拒绝是 `denied`，明确部分成功且部分失败是 `partial_failure`，缺少有效回执才是 `result_unknown`。领域诊断不要求必须采用 CLI；只要主技能、业务意图、拒绝状态及下一步正确，可在事前判定中允许其他合法方法。

## 执行

使用维护者的 Node.js 环境及既有依赖。先保存修改前的实际完整 CLI 技能，再修改候选。`BASE_SKILLS` 与 `CANDIDATE_SKILLS` 各含完整被测目录及相同的固定干扰技能入口。本协议只提供入口正文，不追读干扰技能的其他资源；需要评估执行时另选相应方法。不要把技能源码目录误当单个 `SKILL.md`。

```text
node tools/intent-evaluation.mjs prepare OUTPUT BASE_SKILLS CANDIDATE_SKILLS evals/intent/regression-cases.json evals/intent/regression-rubric.json 1
node tools/intent-evaluation.mjs run OUTPUT development
```

通过开发门槛后冻结候选，另建最终运行目录：

```text
node tools/intent-evaluation.mjs prepare FINAL_OUTPUT BASE_SKILLS CANDIDATE_SKILLS evals/intent/verification-cases.json evals/intent/verification-rubric.json 2
node tools/intent-evaluation.mjs run FINAL_OUTPUT holdout
```

由受保护的进程环境提供 `SKILLS_EVAL_API_KEY` 和 `SKILLS_EVAL_MODEL`。默认使用 DeepSeek 的 Anthropic 兼容 Messages 接口；更换接口时设置 `SKILLS_EVAL_MODEL_URL`，并先核对其用量字段口径。不要将密钥写入案例、命令输出或 Git。输出目录应位于忽略的 `.local-validation/`。

`prepare` 拒绝覆盖目录，保存技能、案例、判定、协议哈希和完整调度。`run` 拒绝哈希漂移、已有结果目录、业务工具调用、不完整响应及缺失用量。每个完成案例保存全部模型回执、首次与最终答案、实际入口读取哈希和逐轮用量。失败或中断的运行保留现场，不能通过删答或将错误用量记零获得通过。

## 质量与 token 门槛

候选的首次路由及最终正确数均不得低于基线。关键题不能失败；基线正确的配对不能新增候选失败。完整配对通过后，累计总 token 还须至少下降 10%。最终还需通过自由文本审阅和目录完整性检查。

本接口的每次调用按以下方式累计，包含全部校核和改选轮次：

```text
总输入 = input_tokens + cache_read_input_tokens + cache_creation_input_tokens
总 token = 总输入 + output_tokens
降幅 = 1 - 候选总 token / 基线总 token
```

缓存读取仍是输入 token；缓存价格折扣不等于减少 token。该口径依据 [DeepSeek 官方用量说明](https://api-docs.deepseek.com/zh-cn/guides/anthropic_api/#流式输出与-token-用量)。程序同时保留普通输入、缓存读取、缓存创建及输出，便于复核。字符数、入口文件大小和单轮输出长度均不能替代实际用量。

这是固定目录与已知上下文下的小样本意图检验。共同提示明确了意图格式及系统边界，因此不能将成绩解释为自然产品对话的激活率。相同模型名称也不固定供应商后续权重。重复题不是新增独立题；通过结果不构成所有输入或真实业务执行的保证。当前结果见 [REPORT.md](REPORT.md)。

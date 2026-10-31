# Audit Learning Content

`<模式目录>` 指本技能目录下的 `modes/learning`；项目内容、命令与事实从目标项目入口定位。

Treat a course as a decision system for learners, not a collection of similarly shaped pages. Preserve the shortest path from question to evidence.

只读审查交付问题、依据和建议；下文的编辑、合并、删除及校验调整只在相应修改已获授权时执行。纯润色只修表达并保留原意，不自动补课、出题或重排内容。参考页、索引和交互工具按其用途判断，不要求增加教学练习。

## Teach A Real Platform Task

针对 XRain/Workforce 内容，先区分读者要配置业务、调用公开 API、开发 SDK 应用，还是学习平台内部实现。使用目标实际交付的能力和版本；公开课程不能依赖私有源码，平台内部结构也不能直接变成学员操作步骤。xrainTrain 的 Markdown、课程导航和校验入口以其仓库为准，不复制技能知识或另建导航注册表。

初学建模先完成一个业务对象、一个文本字段和一条记录；接已有系统的课程先演示现有接口请求和结果，无需强行先建对象。进阶到分享、Owner、角色、编排或智能体时，明确这一课新解决的业务问题、最少账号/权限/环境前提，以及可观察的成功和拒绝结果。使用固定测试人物；没有实际运行的实验保留为概念或待验证步骤，不把配置示例称为成功演示。

沿用户常见反馈检查：术语是否是普通开发者熟悉的“对象、字段、记录、接口说明、参数、响应、权限、版本”；例子是否一次引入太多概念；新章节是否只是重复前页。人员登录、应用准入和业务权限分层解释。AI 操作说明需要准确字段与返回，人类课程需要逐步理解，两者从同一事实来源生成，不互相冒充。只有数学或模型内容才检查张量/指标，普通业务教程按其业务定义检查。

## Connect The Learning Task

对本次涉及的教学单元做以下内部核对，不把它强塞成每章的固定格式：

1. 写清读者已经会什么，以及本单元要新增的动作或判断。用到的概念、工具、权限或环境须有已有前提、就地说明或可到达的准备入口。
2. 用一个完整例子连接具体输入、操作或推理、结果及其原因；只引入完成本课判断所需的新知识，不能把代码可运行当作已经理解。
3. 给出改变条件的变式练习及答案或可观察判据，核对读者能否只用已提供的材料推出结果并解释原因。题目、例子与答案不一致时修正对应内容；缺少推理依据时补解释或缩小学习目标，不只换术语和标题。
4. 沿现有课程顺序检查相邻章节：前课产物与状态能否作为本课输入，本课新增了什么判断，结束状态是否满足下一课。保留有明确巩固或变式目的的重复；无新增价值的内容才考虑合并，不另建课程登记表。

## Start With Evidence

1. Read repository instructions and existing content conventions.
2. Inspect the actual navigation registry, content source, build checks, and representative pages before proposing a new template.
3. If the user refers to an ongoing conversation or repeated objections, read [references/course-critique-patterns.md](references/course-critique-patterns.md). Locate the affected reader prerequisites, examples, exercises or lesson transitions; separate requirements already in force from later requests.
4. For a broad audit, run `node "<模式目录>/scripts/audit-learning-content.mjs" <content-root>` to identify candidates. Treat its output as a queue for human judgment, not a deletion list.

## Audit In This Order

### 1. Correctness

- Verify definitions, formulas, units, tensor shapes, metric direction, comparison conditions, dates, model versions, and source scope.
- Separate fact, author-reported result, engineering convention, approximation, inference, and unresolved claim.
- Never improve readability by deleting a condition that changes whether a conclusion is true.
- For current leaderboards or products, require dated snapshots and first-party sources. Never invent current results.

### 2. Learning Depth

- Reject pages that only give definitions, benefits, application lists, or common sense.
- Require evidence that supports this lesson's new action or judgment: a concrete number, actual mechanism, causal chain, counterexample, failure case, or decision boundary. Added terms or numbers alone do not establish learning depth.
- Do not add terminology lessons where the user needs a reference dashboard, current data, or a worked mechanism.
- Keep beginner intuition, then connect it to the real object. A simplified input/output story must not impersonate the internal computation.

### 3. Scanability

- Put 3-4 recallable judgments near the start of a substantial lesson. A short case can use one evidence-backed judgment.
- Make the first-pass path visible in headings and bold conclusions. Use labels such as `第一次必看`, `场景需要时再读`, `进阶`, or `随用随查` only when they change what can be skipped.
- Use numbered causal chains for sequence, tables for repeated-field comparison, and diagrams for spatial or state relationships.
- Do not add a paragraph explaining how to read every page. Encode the hierarchy in headings, bold text, numbering, and layout.
- A repeat reader must be able to reconstruct the page by scanning headings, bold statements, numbers, tables, and figure captions.

### 4. Information Architecture

Give a page its own navigation entry only when it owns at least one independent learner task:

- a distinct question and decision;
- an interaction or locally stored state;
- a frequently used reference surface;
- a dynamic/current data surface;
- or a source artifact whose stable identity matters.

Merge or delete a page when it is only:

- a redirect or migration notice the user does not require;
- a second route list with no new decision;
- a thin introduction repeating its children;
- one conclusion split from the evidence needed to understand it;
- or a template-shaped lesson with no domain-specific value.

Do not use character count alone. A short progress dashboard can be valid; a long page can still be repetitive. Prefer deleting obsolete URLs when compatibility is not explicitly required. When deleting, update navigation, authored links, progress registries, aliases, and validation together.

## Page Test

For each teaching page under review, write a compact internal verdict. For a reference, index or interactive surface, judge its lookup or interaction task instead:

1. **Question**: What learner question exists only here?
2. **New evidence**: What mechanism, number, example, boundary, interaction, or source is not already available nearby?
3. **Skip test**: Can an experienced learner identify what to skip without reading prose that explains skipping?
4. **Merge test**: Would placing this content under a nearby heading reduce clicks without mixing unrelated tasks?
5. **Truth test**: Which sentence would most seriously mislead a learner if wrong?

If a teaching page lacks an independent question or added value, propose merging or removing it; make that edit only within the authorized scope. If the truth test cannot be answered, identify the unresolved claim rather than reporting the page as ready for publication.

## Broad Repository Workflow

1. Inventory all authored pages with character count, headings, links, content type, and navigation membership.
2. Inspect the shortest pages, duplicate paragraphs, entry pages, redirect/alias pages, and directories with many similarly sized lessons.
3. Classify each candidate as keep, deepen, merge, delete, or convert to reference.
4. For an authorized rewrite, edit the smallest coherent set. Do not apply a course template to leaderboards, maps, indexes, glossaries, or interactive tools.
5. Adjust a content convention or regression check only when an affected structural decision is likely to drift, the existing mechanism can check it, and that change is authorized. A criticism does not by itself require governance changes.
6. After changes, run the checks and build required by the repository for that content; report anything not executed.
7. Verify representative desktop and mobile pages in a real browser when authorized changes affect navigation or interaction.

## Completion Standard

Report:

- the concrete findings and evidence for a read-only review, or the changed learner task with its manuscript, example and answer evidence;
- pages deleted, merged, deepened, or converted, when changes were made;
- why retained short pages deserve independent identity, when that was in question;
- and the exact verification completed, distinguishing author walkthroughs, actual learner/text consumption and unverified outcomes.

Do not claim a full-content audit from only a word-count scan.

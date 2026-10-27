---
name: shzw-audit-learning-content
description: Audit, write or restructure self-study tutorials, textbooks, courses, learning paths and educational visuals for correctness, depth, navigation, duplication and information density. Use for 教程、课件、学习路线、自学、初学者、内容太浅或重复、可跳读、图解教学 and learner-facing content reviews. Exclude ordinary code docs, API references, release notes, pure copyediting and bug fixes unless instructional design is also requested.
metadata:
  maintainer: 苏州苏宏助为智能科技有限公司
  source: https://github.com/xingshukeji/skills-hub/blob/main/skills/shzw-audit-learning-content/SKILL.md
---

# Audit Learning Content

Treat a course as a decision system for learners, not a collection of similarly shaped pages. Preserve the shortest path from question to evidence.

## Start With Evidence

1. Read repository instructions and existing content conventions.
2. Inspect the actual navigation registry, content source, build checks, and representative pages before proposing a new template.
3. If the user refers to an ongoing conversation or repeated objections, read [references/course-critique-patterns.md](references/course-critique-patterns.md) and translate the objections into repository rules, automated checks, and edits. Do not leave them only in a summary.
4. For a broad audit, run `node scripts/audit-learning-content.mjs <content-root>` to identify candidates. Treat its output as a queue for human judgment, not a deletion list.

## Audit In This Order

### 1. Correctness

- Verify definitions, formulas, units, tensor shapes, metric direction, comparison conditions, dates, model versions, and source scope.
- Separate fact, author-reported result, engineering convention, approximation, inference, and unresolved claim.
- Never improve readability by deleting a condition that changes whether a conclusion is true.
- For current leaderboards or products, require dated snapshots and first-party sources. Never invent current results.

### 2. Learning Depth

- Reject pages that only give definitions, benefits, application lists, or common sense.
- Require at least one layer beyond the slogan: a concrete number, actual mechanism, causal chain, counterexample, failure case, or decision boundary.
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

For every page under review, write a compact internal verdict:

1. **Question**: What learner question exists only here?
2. **New evidence**: What mechanism, number, example, boundary, interaction, or source is not already available nearby?
3. **Skip test**: Can an experienced learner identify what to skip without reading prose that explains skipping?
4. **Merge test**: Would placing this content under a nearby heading reduce clicks without mixing unrelated tasks?
5. **Truth test**: Which sentence would most seriously mislead a learner if wrong?

If question or new evidence is empty, merge or delete. If the truth test cannot be answered, the page is not ready for publication.

## Broad Repository Workflow

1. Inventory all authored pages with character count, headings, links, content type, and navigation membership.
2. Inspect the shortest pages, duplicate paragraphs, entry pages, redirect/alias pages, and directories with many similarly sized lessons.
3. Classify each candidate as keep, deepen, merge, delete, or convert to reference.
4. Edit the smallest coherent set. Do not apply a course template to leaderboards, maps, indexes, glossaries, or interactive tools.
5. Update repository content standards and add a regression check for structural decisions likely to drift.
6. Run the repository's required content checks and build.
7. Verify representative desktop and mobile pages in a real browser when navigation or interaction changed.

## Completion Standard

Report:

- which criticisms became permanent skill/repository rules;
- pages deleted, merged, deepened, or converted;
- why remaining short pages still deserve independent identity;
- and the exact verification completed.

Do not claim a full-content audit from only a word-count scan.

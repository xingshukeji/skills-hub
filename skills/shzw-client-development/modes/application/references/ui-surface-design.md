# UI Surface Design

Use this reference only when the client owns a dense settings, management, form, search, or record-list surface. It is a **generic review supplement**, not a product design system and not a mandate to add a shell, sidebar, table, card, modal, or workflow.

## Inputs, Search, And Empty States

- Keep a visible keyboard focus indicator on operable controls, including text inputs and textareas. Preserve an existing clear caret, border or outline according to the product's interaction design; a generic visual preference does not justify removing a working focus indicator.
- Audit shared input primitives and route-local controls together. Refine distracting duplicate focus effects or layout shifts only when the resulting focused, error, disabled and read-only states remain distinguishable; verify keyboard use on the rendered surface.
- Search growing collections only after the user enters a non-empty term. Do not prefetch candidates when a picker opens or while the query is empty; keep the placeholder as the primary instruction and use one centered visual for the pre-search empty state.
- A modal's close action owns the top-right safe area. Keep search, empty, loading, and result content clear of it. Recheck affected consumers when a shared control changes; select tests and viewport checks according to the changed behavior.

## Scope And Precedence

Before using these checks, identify the actual UI owner and load the project's own sources. Resolve rules in this order:

1. The current user request, ProductContract or equivalent product source, source, types, tests, and accessibility requirements decide product facts and behavior.
2. The project's existing design system, shared component owner, page-family guidance, and navigation contract decide the base structure.
3. This reference adds only generic checks for dense UI surfaces. It does not require another project's settings split, role cards, table layout, navigation, copy, or theme names in this client.
4. The parent skill owns method, delivery scope, and evidence routing; it does not override the product or component owner.

A generic recommendation never outranks an owned product rule. If sources conflict, trace the decision to one owner and fix or clarify that owner. Do not satisfy both documents by adding another container, component variant, or exception.

Treat each check as one of three strengths: an **invariant** protects product responsibility, state truth, accessibility, or a shared owner; a **default** is the smallest proven structure and may yield to an owned product decision with evidence; a **heuristic** is taste-level guidance and cannot justify adding UI or workflow. Keep only invariants and evidence-backed defaults in durable project guidance.

## 按截图和反馈修订

页面视觉评审使用 `shzw-code-review` 的[前端视觉与体验方法](https://github.com/xingshukeji/skills-hub/blob/main/skills/shzw-code-review/modes/frontend/GUIDE.md)，逐页检查排版、空间、层级、识别与操作反馈。本参考只补充具体界面的设计约束，不以“没有错位”代替视觉结论。

截图、圈注或多次纠正涉及多个位置时，先把每处位置、期望变化和需保留的行为写在本次工作记录中。查看原图、实际界面及对应源码；需要参考其他产品的行为时，先查其真实定义或实现，不凭外观猜测设置和取值。

按记录实施，并复用现有组件与数据合同。只有视觉调整授权时，保留字段值、保存及原有业务行为。对确无依据的可见设置，按用户要求和产品事实处理；无法判断的部分单独标明。

完成后，在实际页面逐项对照原图与工作记录。核对受影响的选择、保存和再次进入；相关弹层及窄屏仅在本次改动影响时检查。无法打开实际页面时报告未复验位置，不用源码或静态测试代替视觉证据。单项简单文案修改无需额外建立核对表。

## Decision Contract

Record these answers before implementation or review:

| Question | Required answer |
|---|---|
| Primary job | The one decision or mutation the surface enables |
| Identity | The visible title and its navigation owner |
| Primary action | Zero or one action and its location, as defined by the product owner |
| Query | Search/filter controls and the collection they affect |
| Data tools | Refresh, columns, selection, or export controls |
| Surface owner | Shared list, form, drawer, modal, or workbench primitive |
| Boundary budget | One main boundary by default; each extra boundary needs independent work |
| User language | Business-facing facts without implementation terms |
| Visibility basis | The target user's business fact, decision, or action that independently requires every visible label, state, explanation, control, mock datum, drawer, or modal |

If one answer is unknown, resolve the source of truth before adding copy, containers, or placeholder status.

## Contract Translation Gate

Treat ProductContract, CurrentDesign, and technical boundaries as design inputs that constrain behavior, data, and responsibility. Do not render them as navigation, labels, states, explanations, or controls merely because the internal contract records them. Before completion, inspect every visible string, state, mock datum, drawer, and modal; remove internal architecture, implementation mechanisms, governance rationale, and boundary explanations unless the target user's role and task independently require them.

- **Must pass:** A product object or status remains visible when the target user must recognize, select, or act on it.
- **Must fail:** A panel explains which internal component owns data or execution only to restate a contract or technical boundary.
- **Remain local:** Technical identifiers may appear on an administrator or operator diagnostic surface only when that audience and task require them.

## Surface Checks

- Render one page title when the product surface has a page identity. Put the primary business action where the product's existing header or page-family owner places it.
- Keep supporting copy as plain text unless it represents a real info, warning, error, permission, or decision state.
- Separate query controls, business actions, and data tools even when they share a toolbar row. The query may grow first; data tools may collapse to named icon buttons when the product supports that pattern.
- Use the existing shared list owner for ordinary records. Keep one row per record with stable identity, state, and action positions; do not introduce a competing list abstraction to satisfy this reference.
- Keep one main boundary by default. A nested surface is justified only by independent scrolling, editing, or a separate decision; product-specific workbenches may define another legitimate structure.
- Do not add `min-height`, blank bands, or decorative headers to make sparse data look substantial. Counts are plain metadata; badges and pills express persisted state, exceptions, or decision-relevant facts.
- Icons, borders, and background fills must explain identity, state, or action. Remove decoration that only increases visual weight.
- Describe what the user can inspect or do next. Do not expose API, DTO, provider, host, database, or internal permission terms unless the product explicitly serves that audience.
- Removal, disablement, archive, and other destructive actions require the product-appropriate danger semantics, pending protection, failure recovery, and confirmation when material.
- Loading preserves geometry; empty preserves query context and a valid next action; errors stay attached to the owning surface with retry when meaningful.

## Evidence Contract

Choose evidence for the affected rule and behavior:

| Rule | Evidence |
|---|---|
| Title/action ownership, control grouping, count/status semantics | Inspect the affected source and rendered surface; test a changed behavioral contract when needed |
| Visibility basis, user-facing copy, and forbidden internal explanations | Review the affected visible text, states, sample data and overlays in the rendered surface |
| Boundary count, sparse density, spacing, and hierarchy | Inspect the rendered screenshot; use computed styles to substantiate measurements, not to replace visual inspection |
| Responsive wrapping and no overflow | Desktop and named narrow-width browser smoke |
| Destructive mutation, pending, failure, and focus return | Focused interaction test |

Review the affected supported viewport and, when the change affects responsive behavior, a named narrow width such as `390 x 844`. Do not report a surface as finished when required evidence is missing. Do not create a permanent artifact solely for evidence; route unresolved facts to the product or component owner.

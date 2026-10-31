# Client Contract Template

Use this reference to capture the minimum facts needed to start implementation. Keep the answers in the project's formal owner when they become durable product or design facts; this template is not a second ProductContract.

Select the fields needed for this request and reuse confirmed answers. An ordinary Web change needs its user result, UI/data/identity boundary, affected viewport and completion rule; it does not need new installer, Runtime or update owners.

## Contract

```text
Outcome:
In scope:
Out of scope:
Target objects and allowed persistent writes:
State to preserve or restore:
Execution type: Development | SystemTest | Deployment

Product role:
Existing UI owner:
Supported platform/architecture:
Install source and repair owner:
Runtime/process owner:
Update owner per component:
Distribution mode: self-use | internal | controlled | production
Post-activation recovery:
User confirmation boundary:
Active-work drain rule:
Completion rule:
```

## Source And Provenance

For every material answer, classify it as one of:

- Confirmed requirement: explicit user instruction or bounded delegation.
- Verified fact: source, types, tests, measured behavior, or formal owner.
- Working assumption: reversible recommendation that still needs confirmation or evidence.

Silence, repetition, prior-plan inclusion, and copied wording do not turn an assumption into a requirement.

## Owner Matrix

| Fact or behavior | Sole owner | Do not copy into |
|---|---|---|
| User-visible product behavior | ProductContract and source | skill or installer reference |
| Capability architecture | CurrentDesign and source/tests | product contract or generic skill |
| Commands and recovery procedure | Runbook | skill or README copy |
| Distribution and signing policy | distribution-and-signing.md plus the project's configured source owner | ProductContract or main skill |
| Reusable client method | [shzw-client-development](../../../SKILL.md) | project docs |
| Platform or delivery variant | the relevant reference | main skill |
| Authorized recoverable activity | TASK_CONTROL and its plan | ProductContract or skill |

When two sources disagree, stop expansion and repair the owner. Do not preserve both versions as caveats.

## Completion Check

The contract is ready when the requested result, affected boundaries and observable completion rule are resolved. Resolve install, Runtime, update and recovery ownership only when those responsibilities change or are needed to prove this result; unchanged or inapplicable responsibilities do not block implementation. Later publication or independent system testing remains a separate task.

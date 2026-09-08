# AI usage

## Tools and scope

I used OpenAI Codex to write the implementation and tests based on my instructions and
feedback. I directed the scope and booking behavior, reviewed each slice, requested changes
and independent adversarial reviews, and approved the work before committing.
Codex also ran commands, inspected diffs, and checked the UI.

## Where it helped

Codex helped turn the booking rules into runnable checks, including two independent
processes competing for the last seat and a browser test that drops a payment response
after the payment has committed. It also handled the repetitive setup, fixtures, route
handlers, and test runs while I reviewed each slice before committing it.

## What I corrected

I asked for a final availability check before starting payment even though it cannot
eliminate the race. It improves the customer's experience when a class is already full;
the backend still decides whether the seat can be confirmed. I also asked for separate
payment and booking outcomes and disabled refund/class-transfer controls so the losing
customer's situation and the deferred scope are visible.

I rejected placeholder and handoff-style wording and asked for plain project documentation.
I did not treat passing tests as enough: the independent review found that the failed-payment
browser test could pass against an old roster, and that recovered payments did not refresh
availability. Both were corrected. A database-lock probe also led to consistent 503
responses for recognized contention during booking creation.

## What I would change next time

I would define the acceptance checks and reserve time for documentation and the walkthrough
before starting implementation. I would test lost responses and delayed UI refreshes earlier,
rather than finding those gaps after the happy paths passed. I would also keep a simple
time log instead of trying to reconstruct active time from commits and tool runs.

## Verification

I used Vitest for schema, service, route, concurrency, and status-rendering checks; Playwright
for browser flows and lost-response recovery; and manual browser checks for status
messages and rosters. Tests use temporary databases. TypeScript and the production build
provide additional checks, and GitHub Actions runs the test suites.

The current suite has 41 Vitest cases and four Playwright cases. The cross-process race
test requires both mock payments to finish, exactly one new confirmed booking, and a final
roster of four; a lock error does not count as a successful race result.

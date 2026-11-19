# Task 6: bounded remote scheduling

`createRemoteScheduler` is internal; no public package export is added. Create one
scheduler per session controller/model. Generation + kind + key identify a demand
inside that instance, so sharing one instance across controllers is unsupported.
Keys may contain protected query/route values: diagnostics expose counts only.

## Composition and demand ownership

Pass `invoke: scheduler.schedule` to the session controller. The controller's
request owner determines acceptance; the scheduler supplies a shared physical
abort signal to the guarded callback and hence to provider open/read/summary.
The callback validates provider result envelopes before retry classification.
The standalone scheduler also normalizes envelopes with `validateRemoteResult`,
so malformed error accessors are never evaluated. Payload acceptance remains in
the session validator; scheduling does not publish or retain cached rows.

`schedule(demand, run)` accepts explicit focused, visible, overscan, or prefetch
priority, in that order, then FIFO within a tier. Open and initial root reads
default to focused; other operations default to visible. Explicit priority wins.
There is no row geometry inference and no adjacent-range merging.

`replaceDemand(scope, demands)` replaces the desired identities/priorities for
one named viewport scope. It cancels obsolete subscribers, updates retained
priorities, and never invokes queued cancelled work. Call it before scheduling
new viewport demand. It does not itself create requests or store a demand history.

Identical live demands share one physical callback and their first admission's
deadline. All subscribers must agree on the result type and callback semantics;
the first callback runs. Each subscriber retains its own signal and late-result
hook. Cancelling one subscriber cannot cancel another. Priority reflects the
highest remaining live subscriber. When the last subscriber cancels, the job
leaves deduplication and the shared signal aborts. A later demand, even with the
same key, cannot attach to that abandoned physical operation. Generations never
share a deduplication entry.

## Bounds, retries, and refusal

Defaults (explicit positive integer overrides are available):

- Four physically invoked unsettled promises.
- 64 queued jobs, including jobs waiting for retry backoff.
- 256 subscriber records, including cancelled records awaiting late authority.
  This provisional composition limit is separate from the job limits.
- One 30-second deadline per job, measured from first admission, across queue
  delay, invocation, and retries. Dispatch and settlement independently check the
  absolute deadline, so delayed timer delivery cannot admit late work or success.
  Configured deadlines cannot exceed the native
  timer maximum of 2,147,483,647 milliseconds.

Only normalized `transient` failures retry, with at most three attempts total.
The first retry waits 250–299 ms and the second 1,000–1,199 ms, using a seeded
pseudorandom sequence (default seed 1). Retry-after is a lower bound; timers are
capped at the remaining overall deadline to avoid native timer overflow.
Unauthorized, malformed, capability/query, consistency, expired, timeout, and
cancelled errors never automatically retry. Callback throws/rejections normalize
to transient. No retry is launched after the deadline.

At full queue capacity, a higher-priority new demand may cancel the oldest queued
job in the lowest-priority tier. Equal/lower-priority demand is refused with
`cancelled`. Backoff also owns queue capacity; admission may conservatively refuse
new work when all queue slots are held by retries even if a physical slot is free.
A transient physical result arriving while the queue is full returns its original
transient failure rather than creating a 65th queued job. Subscriber-cap refusals
also return `cancelled`. Refusals and preemption are explicit demand outcomes, not
provider failures and not automatic restart triggers.

`getSnapshot()` reports active, queued, stalled, subscribers, dedupeEntries,
timers, and disposed. Active includes physically pending cancelled/timed-out work;
stalled counts that subset. Queue and deduplication metadata are removed when
ownership ends; no lifetime request history is retained. Each live job has at
most a deadline timer and a backoff timer. Counts form the metadata accounting seam
for Task 7; they are not byte budgets or incoming payload reservations. Cache
admission and retained/incoming byte limits remain Task 7 work.

## Cancellation, late authority, and disposal

Caller timeout/cancellation settles promptly and aborts the physical signal once
no subscribers remain. The physical permit is held until the invoked promise
actually settles, even if a provider ignores abort forever. Four stalled providers
therefore prevent further physical dispatch; no replacement loop opens unbounded
requests. Queued deadlines can still settle without invocation.

A cancelled subscriber with `onLateResult` remains bounded by the subscriber cap
until its physical result arrives. The scheduler delivers only normalized failure
envelopes through that hook. Session integration accepts only the existing
request-owned, same-session authorization revocation exception: late data and
ordinary errors cannot bypass generation/range acceptance. Tests cover timeout
and same-range supersession followed by a late session-unauthorized result;
protected retained views are purged in both cases.

Abandoned successful opens need resource cleanup even after scheduler disposal.
That cleanup belongs to the guarded physical provider call: it validates and
releases the returned session if the signal is aborted or request ownership was
lost, then returns cancelled so the regular acceptance path cannot double-release.
When settlement first discovers a deadline after the guarded open has already
returned, a separate request-owned `onDiscardedResult` hook validates and releases
that abandoned session. It is cleanup only and never publishes data or feeds the
authorization path. Settlement captures this cleanup before reentrant clock calls,
so disposal inside that boundary cannot lose the resource. Returned values are
not retained in scheduler state.

Dispose the session controller and scheduler together. Scheduler disposal clears
queued ownership, subscriber listeners/hooks, dedupe entries, and timers, aborts
physical signals, and rejects new work. Still-unsettled physical promises remain
visible in active/stalled counts until they settle. Late hooks do not fire after
disposal. No disposed scheduler can force a noncooperative provider to settle.

Clock and timer operations are injectable. The default elapsed clock is monotonic
`performance.now()`. Provider session `expiresAt` remains epoch-based in the
session controller; Task 8 must not compare that timestamp to the scheduler's
elapsed-clock origin. Shared cancelled/timeout diagnostics and their nested error
objects are frozen. Tests use deterministic fake time with
no real sleeps. External observer errors are isolated; ownership is checked again
after reentrant clock/abort boundaries. There is no callback priority resolver;
priorities are explicit values.

## Verification

Focused fake-clock cases cover priorities, root priority, demand replacement,
independent subscriber cancellation, generation isolation, queue refusal and
prefetch displacement, retry backoff/queue-full admission, deadline and stalled
permits, safe envelopes, late authorization, late-open cleanup, reentrancy,
callback failures, and disposal. These are functional bounds tests, not evidence
of an 8 ms dispatch or UI frame-time target.

# agent-web v0.71.0

<p align="center">
  <img src="docs/media/hero.png" alt="agent-web: integration tests an agent can be judged on" width="100%">
</p>

<h3 align="center">Integration tests written for agents</h3>

<p align="center">
  One case, two implementations, and the verdicts have to agree.
  Where they disagree, either the implementation has a hole or the assertion is asleep.
</p>

<p align="center">
  <img alt="node" src="docs/media/badge-node.svg">
  <img alt="dependencies" src="docs/media/badge-deps.svg">
  <img alt="license" src="docs/media/badge-license.svg">
  <a href="https://github.com/liuzheng6621/agent-web/actions/workflows/ci.yml"><img alt="ci" src="https://github.com/liuzheng6621/agent-web/actions/workflows/ci.yml/badge.svg"></a>
</p>

<p align="center">
  <b>v0.71.0</b> · 21 assertion kinds · 32 commands · 69 mutants
</p>

<p align="center">
  That line is computed, not written: the version comes from <code>package.json</code>, the kinds from <code>KINDS</code>,
  the command and mutant counts from the code itself. <code>scripts/status-line.mjs</code> goes red when any of them drifts.
</p>

---

<p align="center">
  <a href="#should-you-use-this-thirty-seconds">Thirty seconds</a> ·
  <a href="#sixty-seconds">Sixty seconds</a> ·
  <a href="#three-verdicts-not-two">Three verdicts</a> ·
  <a href="#validated-across-six-domains">Six domains</a> ·
  <a href="#commands">Commands</a> ·
  <a href="#boundaries-implemented-vs-still-open">Boundaries</a> ·
  <a href="#docs">Docs map</a>
</p>

## Should you use this? Thirty seconds

**It won't help if your agent tests look like this**: one implementation only, assertions that ask a model "does this look right", and a human reading logs when something fails.

**It's written for this**:

| What you have | What this maps to |
|---|---|
| A mock implementation and a real backend, but nobody proved they behave alike | `compare`: run one case twice, verdicts must agree line by line |
| Tests fail and you can't tell whether the code broke or the environment didn't start | Three-valued verdicts: `unknown` is its own conclusion, not a euphemism for failure |
| Many assertions, no idea which ones actually do anything | `certify` + mutants: deliberately break the implementation, see which assertion catches it |
| You want an agent to edit code but can't let it decide whether the edit was right | Assertions are machine-judgeable; no LLM judge. `selftest` labels 12 cases by mechanism |
| An API but no tests, and no idea where to start | `discover`: give it a URL, get a runnable adapter and case drafts |

In one line: **you want an answer to "is the code the agent wrote actually correct" that doesn't depend on trust.**

What it is not, stated plainly: no performance testing, no UI testing, no security scanning. It answers one question — **does this business operation behave the way a written-down, machine-checkable expectation says it should.**

## Sixty seconds

<img src="docs/media/terminal.png" alt="agent-web: selftest first, then record traffic to grow an adapter" width="100%">

The first command needs no preparation:

```bash
git clone https://gitee.com/liu-everything_impossble/agent-web.git
cd agent-web
node bin/agent-web.mjs selftest
```

`selftest` runs built-in cases against the built-in memory implementation: pass, fail, unknown — one of each.
The fail tells you "order 1001 is currently MAKING, cannot jump straight to PICKED" — not just "test failed".

Already have a running system? Pick the step you want to skip:

```bash
./quickstart.sh http://127.0.0.1:8080        # Windows: .\quickstart.ps1 <that url>
#   read-only endpoints  -> a working adapter + case drafts + a NEXT.md work order
#   traffic you can record -> tap + learn: adapter, twin and cases all at once
```

`quickstart.sh` is `discover` plus three "what next" hints. It does not guess business rules:
whatever it could not infer goes into `NEXT.md` instead of being quietly made up.

See it move:

<img src="docs/media/demo.gif" alt="selftest -> tap/learn -> certify terminal animation" width="100%">

52-second introduction (three verdicts, point at a URL, record traffic, assertion admission, drills): [docs/media/promo.mp4](docs/media/promo.mp4)

## The problem

Agents change code fast. "Did it change it correctly" still gets answered by clicking through the app.
Unit tests miss state that crosses requests. End-to-end tests are slow and flaky.

agent-web does this instead: a real business operation becomes a **case** (what to do + what the result must be), then the case runs against two implementations — a built-in in-memory one and your real system. The two verdicts have to agree.

<img src="docs/media/loop.png" alt="one case, two implementations, one comparison" width="100%">

Agreement means the case is portable and the assertions are not pinned to one implementation. Disagreement points at one place to fix, and tells you which.

## Three verdicts, not two

<img src="docs/media/verdicts.png" alt="pass / fail / unknown" width="100%">

- **pass**: every assertion holds.
- **fail**: at least one assertion fails, with which one, expected what, got what.
- **unknown**: missing observation, environment fault, or case not yet confirmed. **Stays in the denominator, never counts as pass.**

Decidability rate = (pass + fail) / N. Unknown is not recycled, so this number only rises when observation gets fixed — never when problems get hidden.

## Point it at a URL

<img src="docs/media/discover.png" alt="discover: from URL to read-only adapter and case drafts" width="100%">

No adapter needed to start. `discover <url>` probes the root path, tries 8 common OpenAPI locations, then:

- Read-only endpoints → a working read-only adapter (write capabilities return `unsupported`)
- Each resource → a case draft with one assertion: `unchanged` — reads must not change anything
- Create endpoints (`--writes`) → round-trip cases: create one, assert `count_delta +1`
- A `NEXT.md` work order: to add write support, change these four places, verify each step

It does not guess three things: what write operations should guarantee, paths for parameterized endpoints, or routes when there is no OpenAPI. Guessed 404s become false failures, and false failures destroy trust.

## Record five minutes of traffic, grow an adapter

Writing an adapter used to be the expensive part. This section shows how to compress it to ten minutes.

```
agent-web tap --target=http://127.0.0.1:8199 --port=8197 --out=.tmp-tap/rec
# In another terminal, click around: log in, create three tasks, complete one, view the list
agent-web learn .tmp-tap/rec/traffic.jsonl --out=.tmp-tap/learned --name=tasks
```

Four things come out together:

| Artifact | What it is |
|---|---|
| `adapter.yml` | Declarative adapter, no code |
| `twin.json` | Replay twin: what the app agreed to in those five minutes |
| `cases/*.json` | Case drafts, assertions only where observation alone proves them |
| `unclassified.jsonl` | Shapes it could not name, none hidden |

![tap: record real traffic, grow an adapter, a twin and cases](docs/media/tap.png)

`twin.json` is a free second implementation. Same cases against the real system and the twin:

```
agent-web compare .tmp-tap/learned/cases --adapters=.tmp-tap/learned/adapter.yml,.tmp-tap/learned/twin.json
```

```
Cross-adapter verdict agreement 100.0% (1/1)

View contract
  learned/adapter.yml vs learned/twin.json: compatible (2 collections byte-identical)
```

Then the most important step — **break the app, do not re-record**:

```
TODO_APP_BUG=1 node examples/todo-app/server.mjs &
agent-web verify .tmp-tap/learned/cases --adapter=.tmp-tap/learned/adapter.yml
```

```
FAIL todo/recorded   assertion_false
     goal not met: tasks changed 2 (expected 3)
```

That red proves the case catches the app's **behaviour**, not the recording's text. If tap just stored responses, the broken app would still go green.

Three hard rules:

- **Record state, not actions.** Similar tools record actions and get a script; we record state and get a twin and a verdict.
- **Passwords and tokens never land on disk.** Replaced with stable pseudonyms like `password#1`; the same value always gets the same name. User-supplied content in request bodies is not redacted — the recording file is still internal material.
- **Everything generated is marked `inferred`, cases default to draft.** No `accept` means no verdict — machine observation must not impersonate human expectation.

Three things it does not do: guess business rules (recording a successful delist does not mean knowing "insufficient stock should reject"); replay paths it never recorded (`unknown`, not `pass`); handle multi-role links (recording an admin-only delete replays as 403).

## Assertions say more than "row 0 equals 56"

21 kinds, all machine-judgable, none of them "let the model eyeball it":

| kind | What it says |
|---|---|
| `entity_exists` / `field_equals` | A row exists / a field equals a value |
| `count_delta` | A collection's size changed by N |
| `status_transition` | Status walked through a given sequence |
| `unchanged` | A slice of observation did not change from initial to final |
| `event_absent` | An event type never occurred |
| `relation` | Relationships between fields: total equals sum of line items, unit price times quantity equals subtotal, list is sorted |
| `sorted_by` / `unique` / `type_of` / `subset` | Shape: ordered, no duplicates, correct type, values within a set |
| `composite` | And / or / not |
| `window` / `every_step` | Scope an interval / check an invariant after every step |
| `pagination` | Check duplicates, omissions, order and total across pages |
| `payload` | Assert a step's HTTP response body |
| `linkage` | Check entity links and cardinality across collections |
| `timeliness` | final | Two events' real timestamps must differ by no more than a bound (`max:"24h"`); `timezone` is required |
| `state_machine` | trace | Only declared edges are allowed (`transitions`); `walk:"rows"` walks the event log itself |
| `recurrence` | Scheduled jobs: slots laid out at fixed intervals inside a window; catches duplicate runs, drift, gaps and wrong counts |
| `precedence` | Log relative order: `expect` lists events in order and greedy-matches them as a subsequence; catches skipped events (`precedence_missing`) and reversed order (`precedence_inverted`) — immune to extra rows, which index-pinned assertions are not |

Relations are more portable than hardcoded values: `totalAmount == Σ items.subTotal` should hold on any implementation, while `totalAmount == 56` only holds when menu prices have not changed. Shape assertions work the same way — "no duplicates" does not depend on any specific id.

## Admission test: an assertion must prove it is useful

<img src="docs/media/certify.png" alt="mutants are machine-generated, admission is machine-judged" width="100%">

Assertions are not descriptions, they are weapons. **An assertion that kills no mutant is not allowed in.**

How: decompose a "capability" into a set of semantic mutations (amount off by one cent, all quantities become 1, history swallowed, unauthorized write accepted…), let each assertion try to kill them. Holds on the correct implementation, fails on the broken one — that counts as caught. Holds on both — decoration.

<img src="docs/media/certify.gif" alt="certify running animation" width="100%">

Catch rate evolution, each step backed by a mechanism going live:

| Phase | Caught | How |
|---|---|---|
| 12 hand-written mutants | 8 / 12 | Basic assertions |
| + relations | 11 / 12 | `relation` |
| + shape assertions | 14 / 16 | `sorted_by` / `unique` / `type_of` / `subset` |
| + machine-generated | 38 / 40 | `breed` generates mutants from the view shape |

Uncaught splits into three tiers, never mixed: **owed** (difference visible, just needs an assertion), **undetermined** (cannot even produce a difference — confirm the case reached that path first), **not applicable** (this adapter does not declare that capability). "Undetermined" is not equivalent — the equivalent mutant problem is forty years unsolved; here we only require the contributor to provide a distinguishability proof.

It does not just say where the hole is, it says which assertion to add: every suggestion from `--suggest` is verified on both implementations on the spot (correct implementation true, broken implementation false). Those four lines were not thought up — they were run.

### Run twice, differences that always change are not faults

<img src="docs/media/drift.png" alt="drift is not a witness" width="100%">

Running the same case twice changes auto-incremented ids, timestamps and pickup numbers. Previously these differences counted as "the mutant was seen": on the real backend the witness for `m-duplicate-row` was the order id growing from 196 to 210, and the tool would even suggest writing `orders.0.id == 196`. Now every case runs twice against the correct implementation first; the drift set is subtracted from the witnesses.

Side benefit: state-layer mutants only wrap observation, so certify no longer replays the whole trajectory — it transforms the correct run's context directly. On the real backend, 3 cases went from 44.5s to 15.1s (2.95x; timing measured on the author's own machine and CI — self-attested). Equivalence is proven cell by cell by `scripts/state-equivalence.mjs`, which runs in CI.

## Mutants no longer rely on human imagination

`breed` generates faults from the canonical view's shape: numeric fields off-by-one / doubled / dropped, strings emptied / uppercased, arrays tail-dropped / reversed, enums swapped, nested leaves tried one by one. 10 generatable positions yield 28 mutants; 4 identity operators are skipped automatically.

**Generation is not admission**: every mutant must pass certify; unkillable ones fall to "undetermined" automatically and do not pollute the catch rate. Mutants can also declare `applies_to` — a ledger-domain mutant in the coffee domain is "not applicable", not counted in the denominator.

## Pagination: every page looks fine, the pages together do not

The four ways paging breaks all live *between* pages: a row appearing on two pages,
a row lost at the boundary, order flipping between pages, a `total` that disagrees
with what you actually got. **Each page on its own looks perfect**, and per-page
`count_delta` assertions all pass — every page really did return `pageSize` rows.

```json
{ "kind": "pagination", "collection": "orders", "steps": [6, 7, 8],
  "total": 5, "pageSize": 2, "ordered_by": "id" }
```

It reads the **execution payloads** of those steps (`trace[i].payload`), not the
canonical view: the view is a whole-state snapshot, and a paged list looks exactly
the same there as an unpaged one.

Three mutants that only touch the response body (the view never changes, so nothing
else can catch them): `m-page-duplicate`, `m-page-drop`, `m-page-shuffle`.

Also fixed a real bug: the `memory` adapter filtered `order.list` by `ownerId` on the
**canonical view**, which only carries `username` — so a customer's order list was
always empty and only staff saw everything. No case used `order.list` before, which
is why it stayed hidden.

## Drills: labels produced by a mechanism, not a model

<img src="docs/media/drill.png" alt="drilling and grading" width="100%">

One mutant plus one case makes one question. The question gives symptoms and existing assertions, **not `catch_hint`, not the mutant id**. Grading ignores what the submission claims — it puts the submission's assertions on both implementations: holds on correct, fails on broken, that counts as solved.

Same questions, two submissions: carefully written 11/11, exit 0; the one that copies the case's original assertions 0/11, exit 1 — every assertion it submits is genuinely true, indistinguishable from reading the code, only runnable. That is what "labels do not need a human to assign" means.

Why good has only 11 answers but there are 22 questions: suggested assertions can only express "a field value difference within a collection"; whole-entity replacement and cross-collection differences cannot be expressed. The remaining 11 need human-written answers. So grading splits into two checks: default "must answer all" (miss one, exit 1), `--allow-missed` means "answered ones must be correct" (unanswered reported honestly, wrong or ungradable still fail). CI uses the latter — preventing sloppy work and preventing laziness are two different things, do not merge them into one.

`drill grade --record` appends every grading run to a ledger, `drill stats` summarises it.
The ledger stores the item id, status, per-assertion cells and a submission fingerprint — never the submitted assertions.
So 11/11 reads `100.0% [74.1%, 100.0%]` instead of "100%"; a task needs 5 gradings before it earns a difficulty band, and `drill --order=empirical` serves the hard ones first.

## What a verdict looks like: a page you can open

<img src="docs/media/flow.png" alt="single-case verdict page" width="100%">

`flow` renders one case as self-contained HTML: execution flow expandable step by step, state events, each assertion's three-valued result, rejected steps marked red "expected applied, got rejected". Click "show only deviations" to keep just the problematic rows.

<img src="docs/media/flow.gif" alt="verdict page interaction animation" width="100%">

Give it a directory, get a dashboard: verdict distribution, decidability rate, anchored case index, click to jump.

<img src="docs/media/dashboard.png" alt="multi-case verdict dashboard" width="100%">

<img src="docs/media/dashboard.gif" alt="dashboard interaction animation" width="100%">

## Incident archive: mistakes this repo made, not allowed twice

<img src="docs/media/recall.png" alt="recall hits an old mistake and blocks it" width="100%">

14 entries, each with four requirements: symptom, root cause, fingerprint (structure / witness / detector), **guard** (which command or test watches it). No guard, no entry — an unguarded archive is just a memoir.

`recall` compares fingerprints after a run: first hit prints a notice, **second hit of the same entry exits 1 and blocks**. Deepening memory is not about discipline — it is about exit codes.

## Different names, same fields

`learn` only works if the field names make sense. In someone else's system `totalAmount` may be `sum`,
`pickupNo` may be `no`, and `orders` may be `tickets`. `align` suggests the mapping and **does not decide for you**.

```
$ agent-web align our-view.json their-view.json --out=align.yml
field mapping · 3 collections · 17 / 17 fields → 100.0%
```

Five signals with fixed weights: name (plural-folded into synonym groups), row-wise value agreement,
value multiset agreement (survives shuffled rows), enum overlap, cardinality. Different types are out immediately.

**Low confidence is never guessed**: below 0.75 goes to `unresolved` with top-3 candidates.
The renamed fixture recovers 17/17 with zero mismatches; after shuffling rows, renaming `totalAmount`
to `x9` and deleting `pickupNo` it recovers 15/17 and **still zero mismatches** — the other two are
reported as needing a human signature. A wrong mapping makes a case pass on a field that only looks right.
## Validated across six domains

| Domain | Implementation | What it proved |
|---|---|---|
| Coffee shop ordering | Built-in memory + real Spring Boot backend | Same cases against two implementations, 100% verdict agreement; false passes caught |
| Animal rescue tasks | Real backend + memory fixture | When correctness is entirely invariants (points, approvals, roles), is the assertion vocabulary sufficient |
| Double-entry bookkeeping | Two custom implementations (integer cents vs two-decimal strings) | Internal representations completely different, views byte-identical; debit-credit balance invariants expressible |
| Lexicon search `cases/lexicon` | Two custom implementations (trie + greedy segmentation / sorted array + reverse DP) | 900 rows, 10 per page, three pages: cross-page duplicates, boundary drops and lying `total` only show up at this scale — [details](docs/domains/lexicon.md) |

| RealWorld contract `cases/realworld` | Two independent implementations (`fake-server.mjs` is Map-backed, `fake-server-b.mjs` is array-backed) | One OpenAPI contract plus 13 official hurl suites converted verbatim: 100% verdict agreement — and when B is deliberately broken, `compare` names the exact case that disagrees |
| Scheduled jobs `cases/cron` | Two custom implementations (array + slot Set with stored nextDue / slot-key Map with lastSlot) | Time is a slot sequence, not a scalar: `recurrence` catches double-fires, drift and gaps; 3/3 verdict agreement — [details](docs/domains/cron.md) |

The third domain forced a mechanism: mutants can declare `applies_to`. A ledger-domain mutant in the coffee domain is "not applicable", not counted — otherwise the catch rate gets smashed by irrelevant mutants into a false pit.

The fourth domain (lexicon) adds a **data-scale** dimension: the first three domains only ever ran pagination assertions over single-digit result sets, where a lying `total` or a dropped boundary row looks green. It also exposed a blind spot in the `pagination` assertion itself — it summed page sizes and never read the `total` the implementation reported, so "30 rows reported as 900" passed as long as every page was full.

### Why the fifth domain counts: two implementations and a comparison that sees bugs

RealWorld (84k stars, one OpenAPI contract, 990+ implementations) — its 13 official hurl suites are now 13 cases.
The threshold is "two independent implementations and a 100% `compare`", so a second one was added:
`examples/realworld/fake-server-b.mjs` — same contract, every internal replaced (array storage, a different
slug scheme, incremental counters, a monotonic clock, table-driven validation), only observable behaviour kept.

```bash
node examples/realworld/fake-server.mjs 8299 --allow-reset &
node examples/realworld/fake-server-b.mjs 8298 --allow-reset &
node bin/agent-web.mjs compare cases/realworld --adapters=realworld,realworld-b
```

Result: **13/13 agree, three collections byte-identical**.

But agreement can also mean the cases are asleep, so B ships a fault switch that proves the comparison sees it:

```bash
REALWORLD_B_BUG=order node examples/realworld/fake-server-b.mjs 8297 --allow-reset &
REALWORLD_B_BASE_URL=http://127.0.0.1:8297 node bin/agent-web.mjs compare cases/realworld --adapters=realworld,realworld-b
# -> 12/13, realworld/pagination diverges (pass vs fail), exit code 1
```

`REALWORLD_B_BUG` also accepts `count` (favourite counts stuck at 0) and `owner` (author check skipped).
All three are exercised by `test/realworld-compare.test.mjs` — a test that only checks agreement would
pass for an adapter that does nothing at all.

## Commands

| Command | What it does |
|---|---|
| `selftest` | Zero-dependency self-check, one of each verdict |
| `verify` | Run cases, produce verdicts |
| `report` | Metrics from verdicts; `--counts` counts the trajectory only (steps / repeat reads / detour ratio / wasted writes / retries) and never feeds a verdict |
| `accept` | Confirm a draft; unconfirmed cases produce no verdict |
| `capabilities` | Print capability manifest with evidence levels |
| `coverage` | Capability coverage reconciliation, `--min` sets a threshold |
| `probe` | Probe: check whether the adapter is lying to itself |
| `certify` | Admission test: mutant x assertion kill matrix, `--suggest` gives fixes |
| `breed` | Auto-generate mutants from the view shape |
| `drill` / `drill grade` | Generate questions / grade submissions, labels by mechanism |
| `compare` | Same cases fed to multiple implementations, compare verdicts |
| `drift` | Compare initial-state shapes across two runs |
| `record` / `prepare` / `draft` | Reconstruct trajectories from real action logs, generate case drafts |
| `flow` | Single-case verdict page; give a directory for a dashboard |
| `discover` | Probe a site: read-only adapter + case drafts + work order |
| `crosscheck` | — | Re-fetch through an independent channel and compare responses: consistent / divergent / uncheckable |
| `tap` / `learn` | Reverse-proxy records traffic, grows adapter / twin / case drafts |
| `mutants` | Mutant directory: whose fault, how to catch, how to submit |
| `ingest` | Translate another tool's test report into three-valued verdicts, and count what "green" really proved |
| `audit` | False-green audit: use the real backend as a ruler |
| `traps` | Trap census: how many verdicts in this batch are blind |
| `knowledge` / `recall` | Incident archive / recidivism detection (second hit exits 1) |
| `init` | Generate a case template |
| `version` | Version, recent changes, whether the three version sources agree |

## Design choices

- **No LLM judge.** Cannot decide? Record `unknown` and leave it in the denominator. Introducing a scoring model means bringing the problem you are trying to solve back in.
- **The canonical view is the contract.** Cases only write fields in the view, not implementation details; mapping lives deliberately in the adapter, portability verified by `compare`.
- **"Who does it" is part of the case.** Every step carries `as`; adapters that ignore role get called out by traps.
- **Suggested assertions are verified on the spot.** Correct implementation true, broken implementation false — only then emitted; position-dependent suggestions get an extra warning.
- **Three tiers never mixed.** Owed, undetermined, not applicable each have their own exit; mix them and the baseline table becomes unreadable in three days.
- **Two grading checks never merged.** "Must answer all" prevents laziness, "answered ones must be correct" prevents sloppy work — merging them lets each excuse the other.

## Where ready-made cases come from

Writing cases yourself is the expensive part. `import` admits that and gives an entry that does not guess:
it turns **someone else's API test suite** into case drafts.

RealWorld is a reusable API-contract corpus with 13 official Hurl suites. The importer preserves route actions, path parameters, roles and token captures; unsupported assertions go into `.todo.md` instead of disappearing silently.

<p align="center">
  <img src="docs/media/realworld-hurl-flow.svg" alt="13 official Hurl suites flow through import, human review and fixture verification into three-valued verdicts" width="100%">
</p>

```bash
node examples/realworld/fake-server.mjs 8299 --allow-reset
node bin/agent-web.mjs import hurl examples/realworld/hurl --out=cases/realworld --as=user
# Review every generated case and .todo.md, accept them, then run:
node bin/agent-web.mjs verify cases/realworld --adapter=realworld --detail
```

Walkthrough: [terminal animation](docs/media/demo.gif) · [52-second intro video](docs/media/promo.mp4)

Everything it writes is an **unconfirmed draft**; no verdict until `accept`. The converter only does what it can be sure of:

| in hurl | becomes |
|---|---|
| request + JSON body | one step, capability derived from method + resource |
| `HTTP 201` / `HTTP 422` | expected outcome `applied` / `rejected`; `5xx` blocks are skipped |
| `Authorization` header | which role runs the step (`--as`) |
| `[Captures] slug: jsonpath "$.article.slug"` | a capture on that step, later `{{slug}}` fills the path parameter |
| `[Asserts] jsonpath "$.tags" count >= 1` | a `payload` assertion (reads the response body, not the view) |
| an assertion it cannot read | one line in `<name>.todo.md` — **nothing dropped, nothing guessed** |

**The local fixture is included**: `examples/realworld/fake-server.mjs` is a zero-dependency 19-endpoint implementation, and the adapter lives at `src/adapter/realworld.mjs`. It validates the importer and verdict pipeline; it does not prove compatibility with a real RealWorld implementation.

Keep the status scopes separate: `cases/realworld/*.json` are **derived files** produced by `import hurl` (every assertion comes from the official hurl text and must not be hand-edited). Their current run is **13/13 pass**, and they are in CI. All green proves the converter, the adapter and the fixture agree with each other; it does not prove any particular RealWorld implementation is correct.

For compatibility with a real implementation, point `REALWORLD_BASE_URL` at that service (see `examples/realworld/README.md`).

<!-- limits:start -->
## Boundaries: implemented vs. still open

Two layers. These capabilities already have code and tests and should not be counted as "not implemented":

- **21 assertion kinds** (full list in [docs/SPEC.md](docs/SPEC.md) chapter 4). Among them
  `window` / `every_step` / `pagination` / `linkage` / `payload` / `timeliness` / `state_machine`
  were once written down as "missing capabilities" — each now exists and has a mutant **only it can kill** (`kind-necessity` checks this).
- **`align`** proposes evidence-backed cross-schema mappings, including nested-array drill-down and semantic-overlap detection; low-confidence matches require human acceptance.
- **`crosscheck`** re-fetches through a channel that bypasses the adapter's own `fetch` and compares response fingerprints.
- **`breed`** generates mutants from view shape, 13 operators; a generated mutant must pass `certify` before it enters the catalog.
- **`drill grade --record` / `drill stats`** provide a ledger, Wilson 95% intervals and empirical ordering; an item needs at least five attempts before it gets a difficulty band.
- **`negatives`** derives candidate negative cases from the manifest's declarations (missing required args, role violations, wrong types, boundary violations, absent entities, duplicate submits); everything stays `disputed` and only a review sheet is produced.
- **`discover` / `tap` / `learn` / `import hurl`** grow adapters and case drafts from a URL, recorded traffic, or an existing suite.

The remaining boundaries are numbered to match L1–L12 in [docs/LIMITS.md](docs/LIMITS.md).
**Each entry states only the unsolved part** — what already works is in the list above and is not repeated here:

A word on evidence grades: every number in this README (catch rates, agreement rates, timings) comes from this repo's own CI. The scripts are reproducible — but **reproduction runs the same scripts**, and as of v0.71.0 no third party has reproduced them independently. "Reproducible" is a machine fact, not external validity. The `knowledge/` and `docs/mutants/` contribution channels exist to turn self-attestation into outside evidence, one accepted submission at a time; until one arrives, read the numbers here as "the author's proof that his own ruler is self-consistent", not as correctness rates.

1. **Write semantics still need a human (L1).** `tap` records what the app did, but cannot infer that "insufficient stock must be rejected"; a domain owner must approve the rule.
2. **Field mappings still need review (L2).** Nested-array leaves and same-name/different-meaning fields across collections cannot be decided by machine; a human must sign.
3. **No universal flow-quality score (L3).** Define domain goals, metrics and weights first; keep quality scoring separate from legality verdicts.
4. **Negative expectations still need a human signature (L4).** Whether a request *should* be rejected is a business decision; candidates only produce a review sheet and never enter verdicts.
5. **Mutant coverage is incomplete (L5).** `breed` only faults **observed shape** (13 operators, 63 mutants, 39/41 caught). Execution- and business-layer faults (oversell, refund above paid amount, skipped approval) still need submissions — the generator knows shape, not semantics.
6. **Arbitrary mutant equivalence is undecidable in general (L6).** Finite-state or bounded scenarios can be proved or exhaustively checked; otherwise report "not distinguished within budget," never "equivalent."
7. **Cross-entity ordering is still missing (L7).** Single-chain timing is covered — `timeliness` compares two event timestamps, requires a declared `timezone`, and reports `unknown` rather than false when a timestamp is absent (v0.48.0). What is missing is **across entities**: "the order must be created before stock is locked", "a refund must follow the original payment" need a domain with a dependency graph.
8. **Adapters can still lie (L8).** `probe` checks nine mechanical properties and `crosscheck` (v0.54.0) re-fetches through an independent channel, so together they catch "declared but missing", "role ignored", "reads that write" and "tampering with the response body". What they still cannot catch is a liar that watches the prober (probe shuffles its five middle checks on every run, but the opening/leak/close anchors and each check's internal call pattern stay fixed, so an adapter that can read the source can still tell probing from running), or one that replaces the whole `globalThis.fetch`. Same-process loading also leaves the **blast radius** unisolated — an adapter can patch modules the judge itself imported; "loading an adapter = executing code with your credentials" is literal.
9. **Parallel execution stays disabled for now (L9).** There is no parallel executor; re-enabling it requires byte-identical verdicts, failure causes and per-step receipts between serial and parallel runs.
10. **Difficulty estimates depend on sample sources (L10).** Multiple independent submitters/batches are needed to interpret the result as external difficulty rather than self-test performance.
11. **Real-backend validation covers only six domains (L11).** The threshold is two independent implementations plus 100% `compare` agreement. The first four domains each got a second implementation; the fifth (RealWorld) arrived in v0.55.0, the sixth (scheduled jobs) in v0.60.0. Adding more is still manual work.
12. **The semantic layer covers one domain (L12).** `policy/coffee.rego` is a second, independent declaration of the coffee shop rules; 11 fixtures (1 allow, 10 deny) are judged by `conftest`. The other six domains have no rule copy, and editing the Java rules does not notify Rego — only a failing fixture reveals the drift. Rejection codes and cross-order ordering are out of scope.
<!-- limits:end -->

## Docs

**Start at [docs/README.md](docs/README.md) — the docs map**: every document answers one question, routed by what you need right now. Full list below.

- [docs/GUIDE.md](docs/GUIDE.md) — How to use it: start from a URL, from logs to formal grading, connect your own app
- [docs/SPEC.md](docs/SPEC.md) — Spec: case format, 21 assertion kinds and phases, verdict order table, per-mechanism rules
- [docs/ADAPTER-GUIDE.md](docs/ADAPTER-GUIDE.md) — Connect your own app: three-tier paths, change only four places, verification order
- [docs/LIMITS.md](docs/LIMITS.md) — Ledger of the 11 limits: status, acceptance command, why it stays
- [docs/ROADMAP.md](docs/ROADMAP.md) — What comes next, in what order, and how each item is verified
- [docs/domains/](docs/domains/) — measured details of four domains: animal, lexicon, cron, labaccess
- [docs/museum/](docs/museum/README.md) — the false-verdict museum: 12 exhibits, each a hole this repo actually fell into
- [docs/mutants/](docs/mutants/README.md) — Mutant directory and submission standards
- [knowledge/](knowledge/README.md) — Incident archive and admission constitution
- [docs/media/](docs/media/) — All images, animations and the introduction video on this page, all generated locally (the three SVG badges are too; only the CI badge is rendered live by GitHub)
- [CONTRIBUTING.md](CONTRIBUTING.md) — three non-negotiable rules, six gates before you commit, four typical changes
- [AGENTS.md](AGENTS.md) — written for the AI agent editing this repo: five hard constraints, six traps we've already hit
- [SECURITY.md](SECURITY.md) — "you can make an adapter fool the probe" counts as a valid vulnerability here; and what doesn't
- [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) — attack the claim, not the person

## License

MIT.

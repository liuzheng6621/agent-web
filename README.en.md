# agent-web

**Machine-judgeable integration tests for agents. One case, many implementations, verdicts must agree.**

[中文](README.md) · **English**

Every quality question about an agent eventually collapses into one: who decides whether it did the job right.

The mainstream answer right now is to ask another model to look at it — an LLM judge. That is not testing. That is asking for an opinion. Two models score each other, the numbers come out tidy, and the regression that should have blown up still doesn't.

agent-web takes a blunt position: **if it can be written as an assertion, it never goes to a model.**

---

## What it actually does

You have a real business system — orders, tickets, inventory, approvals, whatever. You want an agent to work on it, and you want to know whether it did the job.

agent-web asks you to do one thing first: **write "did it right" down as assertions.**

```json
{
  "kind": "field_equals",
  "selector": { "collection": "orders", "index": 0 },
  "path": "status",
  "value": "PICKED"
}
```

Then it does three things:

1. Reset the environment, run a trajectory (an agent's, or a hand-written reference)
2. Observe the final state, evaluate the assertions
3. Return a verdict: `pass` / `fail` / `unknown`, with the first failure and its evidence

The verdict is computed by a pure function. No model involved, no score, no "roughly correct".

---

## Three-valued verdicts, and why `unknown` has to exist

This is the part the design refuses to give up.

Binary verdicts force you to record "I can't tell" as either failure or success. Both are lies. So the third value has to exist:

| Verdict | Meaning |
| --- | --- |
| `pass` | Every goal assertion and invariant holds |
| `fail` | At least one assertion is false; first failure and evidence attached |
| `unknown` | This case has no observable criterion in the current environment |

`unknown` is not a failure. It means **insufficient information**: the capability isn't in the manifest, an observation scope is missing, the initial state isn't clean, the adapter itself broke.

The critical part is that it **never leaves the denominator** — it gets counted separately:

```
decidable rate = (pass + fail) / N
unknown rate   = unknown / N
```

A test framework that quietly records `unknown` as `pass` hands you 100% green and then falls over in production. The decidable rate is the only honest self-assessment this thing has.

---

## Quick start

Zero dependencies. Node ≥ 20.

```bash
git clone https://github.com/liuzheng6621/agent-web.git
cd agent-web

# 1. Run the built-in in-memory system (deterministic, no external services)
node bin/agent-web.mjs selftest

# 2. Same cases, real backend (Spring Boot coffee shop, see examples/)
TAIXIANGLIAN_BASE_URL=http://127.0.0.1:8080 \
  node bin/agent-web.mjs verify cases/taixianglian --adapter=taixianglian

# 3. Feed the same cases to both implementations, compare verdicts
TAIXIANGLIAN_BASE_URL=http://127.0.0.1:8080 \
  node bin/agent-web.mjs compare cases/memory-demo --adapters=memory,taixianglian
```

Command 3 is the heart of the project. Output looks like this:

```
case                          memory        taixianglian  agree
-----------------------------------------------------------------
memory/cancel-before-pickup  pass          pass          ✓
memory/foreign-pickup        fail          fail          ✓
memory/goal-not-reached      fail          fail          ✓
memory/happy-path            pass          pass          ✓
memory/readonly-menu         pass          pass          ✓
memory/skip-ready-stage      fail          fail          ✓
memory/unknown-capability    unknown       unknown       ✓

cross-adapter verdict agreement 100.0% (7/7)

view contract
  memory and taixianglian: compatible (3 collections, byte-identical)
```

On the left is a fake system written in a few dozen lines of in-memory code. On the right is a real Spring Boot + H2 backend. Same cases, seven verdicts, all matching.

**A mismatch is the signal.** Either a case quietly assumes a detail of one implementation, or the two sides really do differ. The second finding below was caught exactly this way.

---

## Wiring up your own application

The three commands above run the two implementations that ship with the repo. To point agent-web at **your system**, write one `.mjs` file and pass it in — no changes to this repo:

```bash
node bin/agent-web.mjs verify my-cases --adapter=./my-adapter.mjs
```

An adapter is five methods:

```js
{ manifest(), reset({ seed }), observe(runId), execute(runId, action), close(runId) }
```

`examples/adapter-template/` is a **runnable** skeleton. Its domain is warehouse pick tickets — deliberately unrelated to the coffee shop:

```bash
node bin/agent-web.mjs verify examples/adapter-template/cases \
  --adapter=./examples/adapter-template/warehouse-adapter.mjs
```

```
pass    warehouse/foreign-submit         ok
pass    warehouse/happy-path             ok
fail    warehouse/skip-approve           unexpected_rejection
unknown warehouse/unknown-capability     coverage_gap
```

Four lines, four verdict shapes: a clean pass, a negative case correctly blocked, a negative case that slipped through, and a coverage gap. `createBackend()` in the skeleton is "your system" — swap it for `fetch` and nothing else moves.

Integration guide (including the three most common traps) is in [examples/adapter-template/README.md](examples/adapter-template/README.md).

---

## Two numbers, actually measured

**Verdict agreement 100% (7/7)**: `cases/memory-demo` and `cases/taixianglian` are byte-identical apart from `environment.adapter`. One goes to the in-memory adapter, one to the real HTTP backend. The verdict vectors are identical.

**Decidable rate 85.7% (6/7)**: one of the seven deliberately asks for a capability the system simply doesn't have (refunds). It lands in `unknown`, correctly. That 14.3% is not a defect — it's what this is supposed to look like. It admits it can't see.

Timing: p50 ≈ 1s, p95 ≈ 1.1s against the real backend, including three account registrations per reset.

---

## It caught a false pass once

The first time the seven cases hit the real backend, `foreign-pickup` came back `pass`.

The case says: customer A places an order, staff accepts it and makes it ready, then **customer B comes to pick it up**. On the in-memory adapter it correctly returns `fail` (`not_owner`). On the real backend it passed.

That would mean the backend lets someone else walk off with your coffee — a textbook broken access control. The interesting part is the root cause.

The backend's `OrderFlowService.loadVisible` is clean:

```java
if (!user.isStaff() && !user.userId().equals(order.getUserId())) {
    throw new BusinessException(ErrorCodeEnum.ORDER_NOT_FOUND);
}
```

Nothing wrong there. What was wrong was **my own adapter**:

```js
const token = route.who === 'staff' ? ctx.staff.token : ctx.customer.token;
```

It picked a token by "does this run down the staff lane or the customer lane", collapsing `customer` and `customer2` into the same person. The case said "let B pick it up"; what actually executed was "let A pick up A's order". The `pass` was real. It just wasn't testing the thing it claimed to test.

**A binary framework would have stopped there** — green, move on. So would a three-valued one; the measurement was certain. What caught it was command 3: same case, different implementation, verdict flipped.

This is why cross-implementation agreement is the core and not an optional control experiment. Assertion sets can be wrong, adapters can lie, models can hallucinate; **making two independent implementations return the same verdict on the same case** is the only honest check this thing has.

After the fix, all seven agree. Full write-up: [docs/FINDING-001.en.md](docs/FINDING-001.en.md).

---

## Judging someone else's trajectory, not just an implementation

A case's `reference_trajectory` answers exactly one question: can this path be walked at all. When you evaluate an agent, what you judge is **the path it actually took**.

```bash
agent-web verify cases/memory-demo --adapter=memory --trajectory=examples/candidate-trajectories
```

`examples/candidate-trajectories/` ships two demo trajectories and they come out opposite:

| case | reference | candidate | what happened |
| --- | --- | --- | --- |
| `happy-path` | pass | **fail** | the candidate placed the order and called it done |
| `goal-not-reached` | fail | **pass** | the candidate took an extra `kitchen.ready` and got there |

The second row is the interesting one: same case, reference fails, candidate passes. The assertions test **whether the goal was reached**, not **whether the actions were copied**. Trajectory files share the case structure and the same validation.

In candidate mode, ✓/✗ are relative to `expected.json` (which describes the reference). The gap is the finding.

---

## Detecting whether the system under test moved

```bash
agent-web verify cases/x --adapter=X --out=before.jsonl
# ... the app ships a new version ...
agent-web drift before.jsonl after.jsonl
```

`drift` compares the **canonical-view fingerprint** of the initial state across two batches: same / drifted / only-old / only-new, exit code 1 on drift. Drift is not a wrong verdict — it is the question "does this case still describe the app it was written for". Add one menu item, reshape one field, and a case whose fingerprint doesn't move stays green for no reason at all.

---

## From real traffic to a trajectory: record

Candidate trajectories used to be hand-written, and that is exactly what separated "can judge an agent" from "usable". `record` closes the gap: it eats the request log an agent produced and writes a file `verify --trajectory` consumes directly.

```bash
node bin/agent-web.mjs record examples/agent-traces/happy-path.jsonl \
  --adapter=taixianglian --case=taixianglian/happy-path \
  --out=examples/agent-traces/recorded/happy-path.json
```

Input is JSONL (or a single array), one request per line, at minimum `as`, `method`, `path`, optionally `body`, `status`, `response`:

```json
{"as":"customer","method":"POST","path":"/waiter/order","body":{"dishList":[{"dishName":"拿铁","count":1}]},"status":200,"response":{"code":200,"data":{"id":2}}}
```

Already-normalized actions (`capability` + `arguments` + `outcome`) are accepted too — a runtime will find that the cheapest thing to emit.

What comes back:

```
read 8 entries, reconstructed 4 steps
  s1 order.create as=customer applied {"items":[{"dishName":"拿铁","qty":1}]}
  s2 kitchen.accept as=staff applied {"orderId":"$s1.orderId"}
  s3 kitchen.ready as=staff applied {"orderId":"$s1.orderId"}
  s4 order.pick as=customer applied {"orderId":"$s1.orderId"}

skipped 4: unmapped_request×3 read_skipped×1
```

Three things worth stating plainly:

**Bindings are inferred.** When a step's argument equals an entity id returned by an earlier step, it becomes `$s1.orderId`. Without that, a recorded `orderId: 2` is only true in that one environment — reset the database and it is all wrong.

**Writes only, by default.** Reads are how the agent finds ids; they are not the actions being judged, and mixing them in collides with `allowed_capabilities`, turning a good trajectory into `invalid_action`. Pass `--include-reads` to keep them.

**Unrecognized means skipped, not guessed.** Every skip carries a reason (`unmapped_request` / `missing_as` / `no_outcome` / `unparsable_arguments`) in the output's `skipped` field. Quietly inserting one fake action is far more dangerous than one missing step.

---

## From trajectory to case: draft

`record` settled where trajectories come from. The remaining question was where **cases** come from. Until now that was manual: stare at the final state, hand-write `field_equals` one at a time, then worry whether the `id` you just froze belongs to that one run.

`draft` turns it into a replay:

```bash
node bin/agent-web.mjs draft examples/agent-traces/recorded/happy-path.json \
  --adapter=memory --out=examples/agent-traces/drafts/happy-path.case.json
```

```
replayed 4 steps, final state (initial fingerprint fnv1a32:f584a774)
  menu        3 -> 3      unchanged
  orders      0 -> 1      +1
  status_log  0 -> 4      +4

3 goal assertions
  [0] {"kind":"count_delta","selector":{"collection":"orders"},"delta":1}
  [1] {"kind":"field_equals","selector":{"collection":"orders","index":0},"path":"status","value":"PICKED"}
      └ status stops at "PICKED" (that is where this run ended, not where it should end)
  [2] {"kind":"status_transition","selector":{"collection":"orders","index":0},"path":"status","transitions":[["PENDING","MAKING"],["MAKING","READY"],["READY","PICKED"]]}

1 invariant
  [0] {"kind":"unchanged","scopes":["menu"]}

5 things to confirm
  - status_log is the event stream (manifest.events_scope); no count_delta for it...
  - every assertion above was reverse-engineered from what happened, so the replay always passes.
  - add at least one negative case: unauthorized pickup, illegal transition, duplicate submit.
  - allowed_capabilities is copied from usage, not from intent.
  - delete the draft block once you have confirmed it.

self-check: pass (ok) — this says the draft is well-formed and replayable, not that it is correct.
```

Four things worth stating plainly.

**The output is always green.** The assertions were copied from this run's final state, so of course the replay passes. That sentence has to be printed, or the next person will use it as a judgement. What draft delivers is not a test — it is a **confirmation checklist**: is this value right, should this assertion exist, which negative case is missing.

**Environment-bound fields are never written.** `id`, `createTime`, `pickupNo`, `username` change with a single reset; putting them in an assertion nails the case to one run. Binding expressions (`$s1.orderId`) handle those values. Assertions cannot — there is no `$s1` syntax inside an assertion.

**What it cannot prove, it does not write.** Event-stream counts depend on how finely an implementation logs; choosing which of several new entities is the subject is a business judgement. Both go to `todo` with a reason. Writing one assertion too few is safer than one too many: a wrong assertion stays green forever.

**Negative steps need their capability in the whitelist.** The runner checks `allowed_capabilities` before it ever calls the adapter, so leaving it out turns an `expected_outcome: rejected` step into `invalid_action` before the system gets a chance to reject it — the negative case is locked out by its own whitelist. This was found while building draft; a test guards it.

---

## See a case at a glance: flow

```bash
# Run one case and keep its verdict evidence
node bin/agent-web.mjs verify cases/memory-demo/happy-path.json \
  --adapter=memory --out=happy-path.jsonl

# Render a self-contained workflow map
node bin/agent-web.mjs flow cases/memory-demo/happy-path.json \
  --result=happy-path.jsonl --out=happy-path.flow.html
```

A candidate trajectory can be overlaid too (pass a file or a directory matched by case filename):

```bash
node bin/agent-web.mjs flow cases/memory-demo/happy-path.json \
  --trajectory=examples/candidate-trajectories \
  --result=happy-path.jsonl --out=happy-path.flow.html
```

The generated HTML is a **single file with no dependencies**. Open it directly. Steps, roles, expected/actual outcomes, action arguments, status events, and assertion results share one view. Filter mismatches or unexecuted steps; click a card to expand arguments. Dynamic content is HTML-escaped; fields named like token / password / cookie / API key are redacted by default.

Without `--result`, it draws the planned trajectory and does not invent execution outcomes. If the verdict says `candidate`, it draws the actual executed trajectory first. `flow` is read-only; it never reruns the adapter.

---

## Three concepts

| Concept | What it is |
| --- | --- |
| **Task** | Natural-language goal + allowed capabilities + **hidden assertions**. The agent under test never sees the assertions |
| **Sandbox** | A resettable environment. Reset is not an option, it's a precondition |
| **Verdict** | `pass` / `fail` / `unknown` + first failure + evidence |

One line: **an exam hall for agents**. The paper (Task) is public, the answer key (assertions) is not, and the room (Sandbox) is identical every sitting.

---

## The canonical view: the only way cases travel

If every case only knows its own API, cases grow roots into one implementation and die the moment you change backends.

So agent-web puts a **canonical view** (`agent-web/canonical-view`) in between. Adapters project their system into that shape:

```js
{
  menu:       [{ id, dishName, price, category }],
  orders:     [{ id, username, status, totalAmount, pickupNo, createTime,
                 items: [{ dishName, count, unitPrice, subTotal }] }],
  status_log: [{ id, type, orderId, from, to, by, at }]
}
```

Assertions are written only against this layer. The same case runs against the in-memory fake and the real HTTP backend — **portable cases are the precondition for comparison**.

JSONPath was deliberately dropped: selecting entities (`selector`) and reading fields (`path`) are two different jobs, and separating them lets each be validated and reported on its own.

```json
"selector": { "collection": "orders", "where": [{ "field": "status", "eq": "READY" }], "index": 0 }
```

---

## The view is a declaration, not an understanding

Assertions are written against the view, so the view's shape has to be checkable. Adapters declare it in the manifest:

```json
"view": {
  "version": "agent-web/view/1",
  "collections": {
    "orders":     { "kind": "list", "required": ["id", "status", "totalAmount", "items"] },
    "status_log": { "kind": "list", "required": ["type", "orderId", "from", "to"] }
  }
}
```

The runner checks it against both the initial and final state. A violation is `unknown / invalid_environment`, naming the missing collection or field.

**This has to stay separate from "the collection is empty":**

| Situation | Verdict | What kind of problem |
| --- | --- | --- |
| Missing collection, wrong kind, missing required field | `unknown / invalid_environment` | The adapter didn't project as agreed — **the instrument is broken** |
| Collection present but empty | Assertions report `missing_observation` | Observed, the system genuinely has no data |
| Field value differs from expected | `fail` | The **behaviour** of the system under test |

Blur these three together and "I mapped the wrong field" looks like "this system has nothing", so you go and change the assertions — and make it worse.

There's a useful side effect: `compare` diffs the two adapters' view contracts. Verdicts agree but contracts differ means the agreement is a coincidence — they were judged on different fields and happened to land on the same answer. Real comparability needs byte-identical contracts.

---

## Identity is explicit

Cases don't say "use token A". They say a role:

```json
{ "capability": "order.pick", "as": "customer2", "bindings": { "orderId": "$s1.orderId" } }
```

The adapter binds the role to a concrete identity. In the in-memory adapter `customer → alice`; against the real backend `customer → an account registered on the spot`.

That rule was taught by the bug above. **The moment an adapter can quietly substitute an identity, the case is lying.**

The binding syntax is the smallest possible: `"$s1.orderId"` reads a field off step `s1`'s return value. Referencing a step whose `expected_outcome` is `"rejected"` makes the whole case `invalid_case` — a rejected step has no return value, and reading one only yields `undefined`.

---

## Reset: the third path everyone forgets

The original plan only considered two ways to reset: snapshot rollback (you need snapshotting) and reseeding (you need to wipe the database). Both are expensive.

`identity` is the third and cheapest: **if the application already has accounts, give every case a fresh account. Isolation comes for free, and you never touch existing data.**

That's what the coffee shop backend uses. One reset creates three identities (primary customer, second customer, staff), nothing is cleaned up afterwards, and cases don't interfere. The cost is three extra registrations per reset — still under a second.

```json
"reset_strategy": "identity"
```

What it buys you: the same assertions run against a fake system and against somebody's production-grade backend without going near the data.

---

## Seven assertion kinds

| kind | Phase | What it does |
| --- | --- | --- |
| `entity_exists` | final | A collection holds at least / exactly N entities |
| `field_equals` | final | A field of the selected entity equals a value |
| `count_delta` | initial_vs_final | Net change in a collection equals delta |
| `unchanged` | initial_vs_final | Net change across a scope is zero |
| `status_transition` | trace | The event stream contains the given transition sequence |
| `event_absent` | trace | An event type never occurs |
| `composite` | — | `and` / `or` / `not` over any of the above |

Phase is semantics, not an implementation detail. `status_transition` has to be evaluated over the stream; evaluated on the final state it misses "took a wrong turn in the middle but ended up back where it started".

**`unchanged` only guarantees net change is zero — it doesn't care what happened in between.** To forbid intermediate behaviour, use `event_absent`. These are two different claims, and conflating them produces assertions that always pass.

`and` aggregates with Kleene three-valued logic: any false makes it false; otherwise any unknown makes it unknown.

---

## The constitution

**There is no `llm_judge` kind, and there won't be.**

The moment you hand judging authority to a model, the assertion set degrades into "the model thinks it looks right", and this whole thing loses its reason to exist. The work is to break the goal down to a granularity that structured assertions can express. The parts that won't break down get an honest `unknown` — not a papered-over pass.

---

## What doesn't work yet (the honest list)

Written down so people know where the edges are, not out of modesty.

1. **Adapters are hand-written.** There is no "point it at a URL and get an adapter". There's a skeleton to copy ([examples/adapter-template](examples/adapter-template/)), but "how does my state project into the canonical view" and "which capabilities count as validated" still need a human. The real backend adapter was written against the API docs, one endpoint at a time, about 11KB. This is the most expensive step right now.
2. **View contracts are hand-written, and there is no cross-view mapping layer.** Views can be declared (`manifest.view`) and checked, but the declaration itself is manual; when two adapters use different collection names (one `orders`, one `tickets`), cases don't get translated — you write two sets. Real portability is still missing that layer.
3. **Only final state and event stream are judged, not the process.** `event_absent` can check events, but "the agent clicked three times before getting it right" is not measurable yet.
4. **No promotion path for the `inferred` evidence level.** Capabilities marked `inferred` (say, a multipart image upload) stay honestly marked forever; there's no flow from inferred up to validated.
5. **One adapter, one run, serial.** No concurrency, no distribution across machines.
6. **Complexity labels are just labels.** `complex` is computed from step count, write count and role switches. It is not a difficulty calibration — don't use it as one.
7. **`draft` only copies what happened.** It cannot write the things that must *not* happen — negative cases, forbidden events, time limits. Those still require a human. The tool can only remind you to think about them.

---

## Layout

```
agent-web/
├── bin/agent-web.mjs          CLI: selftest / verify / report / compare / record / draft / flow / drift / capabilities / init
├── src/
│   ├── three-valued.mjs       Kleene three-valued logic (true / false / unknown, and/or/not)
│   ├── values.mjs             normalization, deep equality, stable stringify, structural fingerprint
│   ├── select.mjs             entity selector (collection + where + index)
│   ├── assert/kinds.mjs       evaluators for the seven assertion kinds
│   ├── assert/index.mjs       assertion validation, phase table, aggregation, first failure
│   ├── case.mjs               case validation, binding resolution, label derivation
│   ├── runner.mjs             the six-step verdict pipeline
│   ├── report.mjs             Wilson intervals, summary metrics, agreement, text output
│   ├── view.mjs               view contract: declaration checks, state checks, cross-impl diff
│   ├── record.mjs             traffic → candidate trajectory (http template lookup, binding inference)
│   ├── draft.mjs              trajectory → case draft (replay, assertion synthesis, to-confirm list)
│   ├── flow.mjs               case/verdict → self-contained interactive workflow HTML
│   └── adapter/
│       ├── contract.mjs       adapter contract (manifest checks, four outcomes, evidence levels)
│       ├── load.mjs           adapter loading (built-in name / file path / package name)
│       ├── memory.mjs         deterministic in-memory business system
│       └── taixianglian.mjs   real Spring Boot coffee shop backend adapter
├── cases/
│   ├── memory-demo/           seven cases + expected.json
│   └── taixianglian/          the same seven, byte-identical except for adapter
├── examples/
│   ├── README.md              the reference system under test (coffee shop)
│   ├── adapter-template/      a runnable adapter skeleton + four example cases
│   └── agent-traces/          real traffic log → record output → draft case → flow map
├── docs/
│   ├── SPEC.md                case format specification
│   ├── FINDING-001.md         the false pass caused by collapsed identities
│   └── FINDING-001.en.md      same, in English
└── test/engine.test.mjs       46 unit tests (node --test, zero dependencies)
```

---

## What this is not

- **Not a browser agent model.** It doesn't care how the model operates the UI, only whether it got the job done.
- **Not RPA record-and-replay.** The reference trajectory is a sample for writing assertions against, not a script to reproduce.
- **Not a general-purpose crawler.** It touches only the one system it was authorized for.
- **Not a judge of "does it look good".** Visual and subjective quality is out of range; trying to judge it slides straight back into LLM judging.

---

## Roadmap

- `0.1`: in-memory adapter + real HTTP adapter + seven assertion kinds + cross-adapter verdict comparison + view contracts, working.
- `0.2`: judging someone else's trajectory; event vocabulary; initial-state drift detection.
- `0.3`: `record` — real traffic reconstructed into a candidate trajectory.
- `0.4`: `draft` — replay a trajectory into a case draft, turning "write a case" into "confirm a short list".
- `0.5` (current): `flow` — case, candidate trajectory, and verdict evidence rendered as an offline interactive workflow map.
- After that: cross-view mapping so cases travel between differently-named collections; multi-backend concurrency; a promotion path for `inferred`.

---

## License

MIT. See [LICENSE](LICENSE).

---

## References

- Case format specification: [docs/SPEC.md](docs/SPEC.md) (Chinese)
- False-pass post-mortem: [docs/FINDING-001.en.md](docs/FINDING-001.en.md) · [中文](docs/FINDING-001.md)
- Chinese README: [README.md](README.md)

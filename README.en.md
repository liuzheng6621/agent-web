# agent-web v0.29.0

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
  <img alt="tests" src="docs/media/badge-tests.svg">
</p>

<p align="center">
  <b>v0.29.0</b> · 12 assertion kinds · 26 commands · 22 mutants
</p>

<p align="center">
  That line is computed, not written: the version comes from <code>package.json</code>, the kinds from <code>KINDS</code>,
  the command and mutant counts from the code itself. <code>scripts/status-line.mjs</code> goes red when any of them drifts.
</p>

---

## The problem

Agents change code fast. "Did it change it correctly" still gets answered by clicking through the app.

Unit tests miss state that crosses requests. End-to-end tests are slow and flaky. agent-web does this instead: a real business operation becomes a **case** (what to do, what the result must be), and the case runs against two implementations — a built-in in-memory one and your real system. The two verdicts have to agree.

<p align="center">
  <img src="docs/media/loop.png" alt="one case, two implementations, one comparison" width="100%">
</p>

Agreement means the case is portable and the assertions are not pinned to one implementation. Disagreement points at one place to fix, and tells you which.

## Sixty seconds

<p align="center">
  <img src="docs/media/demo.gif" alt="terminal: run the selftest, then compare against the incident archive" width="100%">
</p>

```bash
git clone https://gitee.com/liu-everything_impossble/agent-web.git
cd agent-web
node bin/agent-web.mjs selftest          # built-in cases + built-in implementation, zero config
node bin/agent-web.mjs report results.jsonl
node bin/agent-web.mjs recall            # compare against the incident archive
```

No dependencies. `node >= 20`. To point it at your service:

```bash
node bin/agent-web.mjs certify cases/coffee --adapter=memory
```

## Three verdicts, not two

<p align="center">
  <img src="docs/media/verdicts.png" alt="pass / fail / unknown" width="100%">
</p>

The third one carries the weight. When observation is missing, or a capability is not declared, `unknown` stays in the denominator instead of turning into `pass`. So "how much was measured" and "how much was decided" are reported as two different numbers:

```
可判定率 87.5% (7/8)   CI95[53%, 98%]
```

More `unknown` means a lower decidability rate. That number says more than a clean 100%.

## Drift is not a witness

<img src="docs/media/drift.png" alt="run twice, differences that always change are drift" width="100%">

Running the same case twice changes auto-incremented ids, timestamps and pickup numbers.
Those differences used to be counted as "the mutant was seen": on the real backend the witness
for `m-duplicate-row` was the order id growing from 196 to 210, and the tool would even suggest
writing `orders.0.id == 196` — an assertion that goes red on any other implementation.

Now every case is run twice against the correct implementation first; the drift set is subtracted
from the witnesses before anything is reported.

The same release made state-layer mutants cheap: they only wrap `observe()`, so certify no longer
replays the whole trajectory — it transforms the correct run's context. On the real backend,
3 cases went from 44.5s to 15.1s (2.95x). Equivalence with full replay is proven cell by cell by
`scripts/state-equivalence.mjs`, which runs in CI.

## Incident archive

<p align="center">
  <img src="docs/media/recall.png" alt="agent-web recall output" width="100%">
</p>

`knowledge/` holds the eight mistakes this repository has actually made. One rule admits an entry:

> An error that cannot be reproduced, or cannot be turned into a check, does not get in.

Every entry therefore ships a minimal repro command and a check that already landed. `recall` compares a live run against the archive: the first hit prints a notice, the second hit **blocks** (exit 1, `--no-gate` to pass).

```bash
node bin/agent-web.mjs knowledge     # list all eight
node bin/agent-web.mjs recall        # scan, see whether an old mistake came back
```

"Deepening memory" here is a verifiable action, not a weight: it counts occurrences and it changes an exit code.

## Commands

Twenty-one commands, grouped by what you have on hand. Full reference in [docs/GUIDE.md](docs/GUIDE.md).

| Group | Commands |
| --- | --- |
| You have a system, want tests | `init` `prepare` `record` `draft` `accept` `verify` `report` `drift` |
| You have two implementations | `compare` `audit` `probe` `coverage` `traps` |
| You want to check the tests themselves | `certify` `certify --suggest` `mutants` `drill` `drill grade` `knowledge` `recall` |
| Odds and ends | `selftest` `capabilities` `flow` |

## Record five minutes of traffic, get an adapter

Writing an adapter used to be the expensive part. `tap` asks a different question: not "what should this business rule be", but "what did the app just agree to".

```
agent-web tap --target=http://127.0.0.1:8199 --port=8197 --out=.tmp-tap/rec
agent-web learn .tmp-tap/rec/traffic.jsonl --out=.tmp-tap/learned --name=tasks
```

Four things come out: `adapter.yml` (declarative, no code), `twin.json` (a replay twin — a second implementation for free), `cases/*.json` (drafts, assertions only where observation alone proves them), `unclassified.jsonl` (shapes it could not name, none hidden).

`twin.json` makes `compare` free: same cases against the real system and against the twin, verdicts must agree. Then break the app and **do not re-record** — the case must go red:

```
TODO_APP_BUG=1 node examples/todo-app/server.mjs &
agent-web verify .tmp-tap/learned/cases --adapter=.tmp-tap/learned/adapter.yml
```

```
FAIL todo/recorded   assertion_false
     goal not met: tasks changed 2 (expected 3)
```

That red is the point: the case catches the app's behaviour, not the recording's text.

![tap: record real traffic, grow an adapter, a twin and cases](docs/media/tap.png)

Three hard rules: record state, not actions; passwords and tokens never land on disk (stable pseudonyms such as `password#1`), though user-supplied content is not redacted; everything generated is `inferred` and cases are drafts until `accept`.

What it does not do: guess business rules, replay paths it never recorded (`unknown`, not `pass`), or handle multi-role links.

## Design choices

**No LLM judge.** Seven structured predicates (`entity_exists`, `field_equals`, `count_delta`, `status_transition`, `unchanged`, `event_absent`, `relation`) evaluated in three-valued logic. The same input always yields the same verdict.

**Adapters project observation into one canonical view.** Field mapping lives in the adapter, not in the case. Swapping an implementation changes nothing in the cases — that is the precondition for cross-implementation comparison.

**"Who does it" is part of the case.** Every step says `as: customer2`, and the runner checks that the adapter really switched identity. When identities collapse into one, the verdict can still be `pass` while the evidence shows the switch never happened. That incident is `FINDING-001`.

**Suggested assertions are verified on the spot.** Every assertion `--suggest` emits is evaluated on both the correct implementation and the mutant; it only appears if both come out as expected.

## What it does not do

1. **Every target system needs an adapter.** The adapter is code, `load` imports it, and loading it runs it with your privileges. The CLI warns once; that is not a sandbox.
2. **Field mapping is written by hand.** No automatic derivation.
3. **Legality, not quality.** It can say a flow is legal, not that it is good.
4. **Negative cases are hand-written.** `draft` lists where they are missing and refuses to invent them: the standard is "what should be allowed", so copying what actually happened admits everything.
5. **Twelve mutants, all of them ours.** The mutant list is open precisely so others can add the ones we did not think of.
6. **Equivalent mutants are unsolved.** They became explicit states: killable, owed, undetermined.
7. **Limited assertion vocabulary.** Seven predicates; no composite constraints like "sorted by creation time with correct paging".
8. **An adapter can lie.** `probe` checks six mechanical properties, not intent. What is guaranteed is "given this observation, here is how the verdict follows".
9. **Validated in one domain only.** A coffee shop: menu, orders, state machine, two roles.

## Docs

| File | Contents |
| --- | --- |
| [docs/GUIDE.md](docs/GUIDE.md) | Full guide in Chinese |
| [docs/SPEC.md](docs/SPEC.md) | Format spec: cases, assertions, adapter contract, verdict order |
| [docs/FINDING-001.en.md](docs/FINDING-001.en.md) | Anatomy of one false pass |
| [docs/museum/](docs/museum/) | Six reproducible failure exhibits |
| [docs/mutants/](docs/mutants/) | Twelve mutants; submission rules in its README |
| [docs/media/promo.mp4](docs/media/promo.mp4) | 42-second introduction |

## License

MIT. Cases, mutants and incident entries are all open to contributions — their value is in the count.

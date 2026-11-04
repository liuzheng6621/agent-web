# agent-web

**Check whether an AI assistant really finished the job.**

[中文](README.md) · **English**

AI assistants can place orders, handle support tickets, and update inventory. The hard part is knowing whether they actually did it right.

agent-web works like a quality inspector with a checklist: decide what a correct result looks like, let the assistant do the work, then check what really happened. It does not judge by tone, gut feeling, or another model's score.

**In one line: give different systems the same test, use the same rules, and compare their results.**

---

## Three possible results

| Result | Plain meaning | Example |
| --- | --- | --- |
| `pass` | Passed | The order was placed and picked up by the right person |
| `fail` | Did not pass | The assistant says an order is ready, but it is not |
| `unknown` | Not enough information to decide | The system does not expose the needed data, or the test connection failed |

“I don't know” is not the same as “wrong” or “right”. So `unknown` is counted separately, never quietly counted as a pass:

```text
decidable rate = (pass + fail) / all cases
unknown rate   = unknown / all cases
```

That way, missing information cannot make the score look greener than it is.

---

## A cup of coffee explains it

The task: a customer places an order, a staff member accepts and prepares it, and **the same customer** picks it up.

A checklist might say:

1. The number of orders increases by one.
2. The final order status is “picked up”.
3. The order goes through “making → ready → picked up”.
4. A different customer must not be able to pick it up.

The assistant may take different steps from the sample route. It passes if the final result meets the rules. A familiar-looking route with the wrong result does not pass.

---

## Try it in 3 minutes

You need Node.js 20 or later. No extra packages are required.

```bash
git clone https://github.com/liuzheng6621/agent-web.git
cd agent-web

# Run built-in examples. No external service needed.
node bin/agent-web.mjs selftest

# Check one specific case
node bin/agent-web.mjs verify cases/coffee/happy-path.json --adapter=memory
```

`selftest` runs seven examples: normal completion, unauthorized pickup, a missing step, and cases with insufficient information. Passing these examples means the basic checking flow works; it does not mean every real system has been tested.

---

## User guide: from action log to a formal verdict

![agent-web workflow: capture a log, prepare files, review rules, verify, and optionally compare systems](docs/prepare-flow.en.svg)

Already have a request log from one run of the assistant? The short path is: log → `prepare` → human review → `verify`. `prepare` creates replayable steps, a draft checklist for review, and a flow-chart preview:

```bash
node bin/agent-web.mjs prepare examples/agent-traces/memory-happy-path.jsonl \
  --adapter=memory \
  --id=coffee/happy-path \
  --goal="The customer places an order and picks it up" \
  --out-dir=agent-web-output/coffee-happy-path
```

You will get:

```text
agent-web-output/coffee-happy-path/
├── trajectory.json     actions rebuilt from the log
├── case.draft.json     a checklist based on what happened
└── case.flow.html      an offline flow-chart preview
```

Review them in this order:

1. Open `case.flow.html`. Check that each person and action is shown correctly.
2. Review the goal, checks, and “to confirm” notes in `case.draft.json`. The draft describes what happened in this run; **passing its own check does not mean its rules are correct**.
3. Add the real business goal and negative cases (for example, another customer must not pick up the order). Then run `verify`.

`prepare` replays the write actions against the adapter you specify, so point it only at an isolated test system, **never production**. If it finds fields that look like passwords, tokens, or cookies, it stops without writing output. It also refuses to overwrite existing output files.

The demo log uses a simple format: operation name, role, outcome, and arguments. It needs no network address. Real HTTP logs are supported too, but the adapter must first map request URLs to operations and translate request arguments. For your own service, replace `--adapter=memory` with your connector and use a dedicated test environment.

After reviewing the draft, add the real goal and any required negative cases. When a person has confirmed it, remove the trailing `draft` note from the case JSON and run:

```bash
node bin/agent-web.mjs verify agent-web-output/coffee-happy-path/case.draft.json --adapter=memory
```

This checks that the case is valid and runnable. A successful run does not prove that the business checklist is complete; a person must confirm that.

---

## Check what the assistant actually did

The steps stored with a case are a sample route, not necessarily the route the assistant took. To check the assistant's own actions:

```bash
node bin/agent-web.mjs verify cases/coffee \
  --adapter=memory \
  --trajectory=examples/candidate-trajectories \
  --out=candidate-results.jsonl
```

`--trajectory` points to files containing the assistant's actions. `--out` saves the results for each case. The repository includes two sample routes: one stops after placing an order; the other takes an extra step and reaches the goal.

**The check is about the result, not copying the sample actions.** The sample route may miss the goal while the assistant takes a different route and succeeds.

The two demo routes intentionally produce different results from the reference answers. `verify` can therefore exit with code 1 and mark the differences; that is the demonstration, not a broken command.

---

## Advanced: run the prepare stages separately

Use `prepare` for the normal workflow. Run `record`, `draft`, and `flow` separately when you want to inspect an intermediate file or replace one stage:

```bash
# 1. Request log → replayable steps
node bin/agent-web.mjs record examples/agent-traces/memory-happy-path.jsonl \
  --adapter=memory \
  --out=agent-web-output/coffee/trajectory.json

# 2. Replayable steps → draft checklist
node bin/agent-web.mjs draft agent-web-output/coffee/trajectory.json \
  --adapter=memory \
  --id=coffee/happy-path \
  --goal="The customer places an order and picks it up" \
  --out=agent-web-output/coffee/case.draft.json

# 3. Draft case → flow-chart preview
node bin/agent-web.mjs flow agent-web-output/coffee/case.draft.json \
  --out=agent-web-output/coffee/case.flow.html
```

After confirming the checklist, remove the trailing `draft` note from the case JSON and run the formal check:

```bash
node bin/agent-web.mjs verify agent-web-output/coffee/case.draft.json \
  --adapter=memory --out=agent-web-output/coffee/results.jsonl

# Refresh the flow chart with the formal verdict and observed events
node bin/agent-web.mjs flow agent-web-output/coffee/case.draft.json \
  --result=agent-web-output/coffee/results.jsonl \
  --out=agent-web-output/coffee/case.flow.html
```

If checking a candidate route (the actions the assistant actually took), `--result` must come from that same candidate route. Do not attach the verdict for the reference route to candidate steps. See [checking an assistant's route](#check-what-the-assistant-actually-did) for the full command.

These commands can also handle real HTTP logs. `record` needs the adapter to map request URLs to operations and convert request arguments. Each log entry needs the actor, request method, and URL; include request content and response when possible. Never log passwords or tokens. Later steps refer to IDs returned by earlier ones. Unrecognized requests are listed with reasons instead of guessed.

The flow chart is a standalone HTML file. Double-click it to open. It shows steps, roles, expected and actual outcomes, status changes, and check results. It supports filtering, expandable arguments, keyboard operation, and light/dark themes. Sensitive inputs are redacted; the page only displays saved data and does not re-run actions.

**A passing draft self-check does not prove the rules are right.** The checklist is inferred from what happened in that sample run, so a replay passing is expected. Before using it as a formal test, have a person confirm the goal, checks, negative cases, and permission boundaries.

---

## Give two systems the same test

agent-web includes an in-memory demo system and can connect to a sample coffee-shop service. Run the same cases against both:

```bash
# Start the sample coffee-shop service on localhost port 8080 first
TAIXIANGLIAN_BASE_URL=http://127.0.0.1:8080 \
  node bin/agent-web.mjs compare cases/coffee \
  --adapters=memory,taixianglian
```

Example output:

```text
case                          in-memory     coffee shop   same result
coffee/happy-path             pass          pass          ✓
coffee/foreign-pickup         fail          fail          ✓
coffee/unknown-capability     unknown       unknown       ✓

same result on 7 of 7 cases (100.0%)
```

Different answers do not immediately mean one system is broken. They tell you to check whether the rules are clear, whether the connection treated customer A and customer B as different people, or whether the systems really behave differently.

This comparison once caught a real problem: the case said “customer B picks up the order”, but the result said pass. The coffee shop had not handed over the wrong drink. The connector had treated customers A and B as the same person, so it actually ran “A picks up A's order”. The test checked the wrong person but still looked perfectly green. Comparing it with an independent implementation exposed the mismatch. Full story: [incident report](docs/FINDING-001.en.md).

---

## Use the real backend as a ruler: false-green audit

"Two verdicts agree" is an observation, not proof. A real ruler has to be another implementation: a case the real backend judges `fail` must also be judged `fail` by the new one.

```bash
# 1. archive both runs
TAIXIANGLIAN_BASE_URL=http://127.0.0.1:8080   node bin/agent-web.mjs verify cases/coffee --adapter=taixianglian --out=real.jsonl
node bin/agent-web.mjs verify cases/coffee --adapter=memory --out=memory.jsonl

# 2. audit one verdict set against the other served as oracle
node bin/agent-web.mjs audit real.jsonl memory.jsonl --detail
```

The output is a confusion matrix:

| Cell | Meaning | Risk |
| --- | --- | --- |
| agree·pass | both say it is fine | — |
| agree·fail | both say it is broken | — |
| **false green** | it is broken, the candidate says fine | worst: it stays green forever |
| false red | it is fine, the candidate says broken | noisy, not dangerous |
| blind | the oracle decides, the candidate cannot | insufficient evidence |

One false green makes `audit` exit 1. This is not a style preference: a false red sends someone to look, a blind spot is honestly recorded as `unknown`, and only a false green makes an unusable verdict look perfect.

## A draft must pass a human first

`draft` derives a case from a real trajectory and marks it `draft.status: "unconfirmed"`. **Such a case produces no verdict** — it is recorded as `unknown / unconfirmed_draft`. A machine-written exam cannot grade anything until somebody has read it.

Confirm it once and it becomes an exam:

```bash
node bin/agent-web.mjs accept cases/coffee/my-draft.json --by=YG
# 已确认 cases/coffee/my-draft.json
#   draft.status: unconfirmed → confirmed
#   reviewed_by:  YG
#   reviewed_at:  2026-11-04T07:41:16.195Z
```

Anonymous confirmation is rejected (`--by` is required): "somebody looked at it" that cannot be named is the same as nobody looking. Hand-written cases carry no `draft` field and are unaffected.

## One copy of the cases

`cases/coffee/` is not duplicated per implementation. The same directory hits different systems by switching `--adapter`:

```bash
node bin/agent-web.mjs verify cases/coffee --adapter=memory
node bin/agent-web.mjs verify cases/coffee --adapter=taixianglian
```

A case describes "what a coffee ordering system should do", independent of who implements it. Copying it per implementation gives you two truths that slowly diverge — FINDING-001 started exactly there: two copies treated as one comparison.

---

## Check whether the system changed

The system may have different starting data after an update. Save the results from before and after, then compare them:

```bash
node bin/agent-web.mjs verify cases/coffee --adapter=memory --out=before.jsonl
# After the update, run it again and save the results as after.jsonl
node bin/agent-web.mjs verify cases/coffee --adapter=memory --out=after.jsonl
node bin/agent-web.mjs drift before.jsonl after.jsonl
```

`drift` checks whether the data visible at the start of a test changed. If it did, review whether the case still fits the new version. This does not mean the verdict itself was wrong.

---

## Connect your own system

Point `--adapter` at a small connector program:

```bash
node bin/agent-web.mjs verify my-cases --adapter=./my-adapter.mjs
```

`examples/adapter-template/` contains a working sample. The connector has five jobs:

| Method | What it does |
| --- | --- |
| `manifest()` | Lists the operations and data the tool can use |
| `reset()` | Prepares fresh test data |
| `observe()` | Reads the current orders, inventory, and other state |
| `execute()` | Performs one operation in the system |
| `close()` | Ends and cleans up the test run |

See the [working connector example](examples/adapter-template/README.md) and [case format](docs/SPEC.md) for the details.

---

## A short glossary

The code keeps fixed English names. Here is what they mean in everyday terms:

| Code term | Plain meaning |
| --- | --- |
| Case | A test question: the goal, checklist, and sample route |
| Trajectory | The sequence of actions the assistant took |
| Adapter | A small connector between the test tool and a real system |
| Assertion | A clear rule that can be checked as right or wrong |
| `unknown` | There is not enough information to score this run |
| Reset | Prepare fresh data so an earlier test cannot affect the next one |

---

## What it can check

| Check | Plain meaning |
| --- | --- |
| `entity_exists` | Does a requested record exist? |
| `field_equals` | Does a field contain the expected value? |
| `count_delta` | How many records were added or removed? |
| `unchanged` | Did specified data stay the same? |
| `status_transition` | Did the status go through the required changes? |
| `event_absent` | Did a forbidden event happen at any point? |
| `composite` | Combine checks with “and”, “or”, or “not” |

It checks concrete facts such as order status, record counts, and recorded events. It does not judge whether a page looks nice, prose sounds elegant, or something “feels right”. If there is no clear rule, it will not pretend that a machine can score it.

---

## Current limits

- Each real system needs a connector written by a person; giving the tool a URL is not enough yet.
- Data names must be lined up by the connector. The tool does not automatically know that `orders` in one system means the same thing as `tickets` in another.
- It mainly checks the final result and recorded events. It cannot yet measure process quality such as “the assistant clicked three times before getting it right”.
- Cases run in order; running them across multiple machines at once is not supported yet.
- A draft can list what happened. A person still has to add rules for forbidden actions, permissions, and time limits.

---

## Project files

```text
bin/agent-web.mjs       Command-line entry point
src/                   Checking, cases, logs, drafts, and flow-chart code
cases/                 Built-in test cases
examples/              Working connectors and sample action logs
  agent-traces/memory-happy-path.jsonl   simple log for trying prepare
docs/SPEC.md            Detailed case-file format
test/engine.test.mjs    Automated tests (49 cases)
```

Common commands: `prepare` (create steps, a draft case, and a flow preview in one run), `selftest` (run the built-in checks), `verify` (check cases), `compare` (compare systems), `record` (organize request logs), `draft` (make a case draft separately), `flow` (make a flow chart), and `drift` (compare whether the starting data changed). Run `node bin/agent-web.mjs help` for the full list.

---

## Pushing to the GitHub mirror

The repo lives on both Gitee and GitHub. On a machine whose `hosts` file points `github.com` at `127.0.0.1` (symptom: `curl https://github.com` returns `000` while `dns` and `conn` take a few milliseconds and `tls` is `0`), `git push github` dies in the TLS handshake. Editing `hosts` needs admin rights and may be overwritten by whatever script wrote those lines.

`scripts/gh-proxy.mjs` routes around it: resolve the name once through DNS (bypassing `hosts`), then relay the tunnel byte for byte. TLS is still negotiated end to end between git and GitHub with the same SNI, so certificate validation stays on and nothing gets disabled.

```bash
node scripts/gh-proxy.mjs &                                     # 127.0.0.1:8899
git -c http.proxy=http://127.0.0.1:8899 push github main
# or set it for this remote only, and delete the config once the proxy is gone
git config --local http.https://github.com.proxy http://127.0.0.1:8899
```

It binds to loopback only and does nothing but relay CONNECT to the address DNS returned; shut it down when you are done. **This is not a feature for users** — it is a maintainer's temporary channel on this particular machine.

---

## Version and next steps

Current version: `0.7`. It runs cases, checks an assistant's actions, turns a request log into replayable steps and a draft case, and has started policing the verdict itself: one copy of the cases, no verdict from an unreviewed draft, and a false-green audit that turns a suspiciously all-green verdict red.

Next: make it easier for different systems to share the same cases, run tests against multiple systems at once, and turn abilities that are only inferred into abilities that have been verified in practice.

MIT license. See [LICENSE](LICENSE).

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
node bin/agent-web.mjs verify cases/memory-demo/happy-path.json --adapter=memory
```

`selftest` runs seven examples: normal completion, unauthorized pickup, a missing step, and cases with insufficient information. Passing these examples means the basic checking flow works; it does not mean every real system has been tested.

---

## Check what the assistant actually did

The steps stored with a case are a sample route, not necessarily the route the assistant took. To check the assistant's own actions:

```bash
node bin/agent-web.mjs verify cases/memory-demo \
  --adapter=memory \
  --trajectory=examples/candidate-trajectories \
  --out=candidate-results.jsonl
```

`--trajectory` points to files containing the assistant's actions. `--out` saves the results for each case. The repository includes two sample routes: one stops after placing an order; the other takes an extra step and reaches the goal.

**The check is about the result, not copying the sample actions.** The sample route may miss the goal while the assistant takes a different route and succeeds.

The two demo routes intentionally produce different results from the reference answers. `verify` can therefore exit with code 1 and mark the differences; that is the demonstration, not a broken command.

---

## See the steps as a flow chart

Turn saved results into an HTML page you can open in a browser:

```bash
node bin/agent-web.mjs flow cases/memory-demo/happy-path.json \
  --result=candidate-results.jsonl \
  --out=happy-path.flow.html
```

For a candidate route, the result file must have been created by checking that same route:

```bash
node bin/agent-web.mjs verify cases/memory-demo/happy-path.json \
  --adapter=memory \
  --trajectory=examples/candidate-trajectories \
  --out=happy-path-candidate.jsonl

node bin/agent-web.mjs flow cases/memory-demo/happy-path.json \
  --trajectory=examples/candidate-trajectories \
  --result=happy-path-candidate.jsonl \
  --out=happy-path-candidate.flow.html
```

The HTML is one standalone file. Double-click it to open; no web server is needed. It shows who did each step, what was expected, what happened, how the status changed, and which checks passed. Filter failed or unrun steps, expand a step to see its inputs, and switch between light and dark themes.

It works on desktop, tablet, and mobile, and supports keyboard operation. Sensitive inputs (such as tokens, passwords, and cookies) are hidden automatically. The flow chart displays saved data; it does not run the assistant again.

---

## Turn request logs into action steps

If your system can export the requests made by an assistant, use `record` to turn them into a step file:

```bash
node bin/agent-web.mjs record examples/agent-traces/happy-path.jsonl \
  --adapter=taixianglian \
  --out=examples/agent-traces/recorded/happy-path.json
```

Logs can be JSONL (one JSON object per line) or a JSON array. Each request needs the actor, request method, and URL. Include the request content and response when possible. Do not put login passwords or tokens in the log.

`record` replaces order numbers returned by earlier steps with references to those steps. The route can then run with fresh test data. Requests it cannot understand or verify are listed as skipped; it does not guess.

---

## Turn completed steps into a case draft

```bash
node bin/agent-web.mjs draft examples/agent-traces/recorded/happy-path.json \
  --adapter=memory \
  --out=examples/agent-traces/drafts/happy-path.case.json
```

The command runs the steps again and makes a checklist from the before-and-after states, such as “one more order” or “the order ended as picked up”. **The draft copies what happened in this run, so it will usually pass its own check. That does not mean the checklist is correct.**

A person still needs to confirm:

- Are these the results the business actually requires?
- Are important “must not happen” cases missing, such as another customer picking up the order?
- Did the checklist accidentally include IDs, accounts, or other details that change on every run?

Anything the tool cannot safely infer appears in a “to confirm” list instead of becoming a rule.

---

## Give two systems the same test

agent-web includes an in-memory demo system and can connect to a sample coffee-shop service. Run the same cases against both:

```bash
# Start the sample coffee-shop service on localhost port 8080 first
TAIXIANGLIAN_BASE_URL=http://127.0.0.1:8080 \
  node bin/agent-web.mjs compare cases/memory-demo \
  --adapters=memory,taixianglian
```

Example output:

```text
case                          in-memory     coffee shop   same result
memory/happy-path             pass          pass          ✓
memory/foreign-pickup         fail          fail          ✓
memory/unknown-capability     unknown       unknown       ✓

same result on 7 of 7 cases (100.0%)
```

Different answers do not immediately mean one system is broken. They tell you to check whether the rules are clear, whether the connection treated customer A and customer B as different people, or whether the systems really behave differently.

This comparison once caught a real problem: the case said “customer B picks up the order”, but the result said pass. The coffee shop had not handed over the wrong drink. The connector had treated customers A and B as the same person, so it actually ran “A picks up A's order”. The test checked the wrong person but still looked perfectly green. Comparing it with an independent implementation exposed the mismatch. Full story: [incident report](docs/FINDING-001.en.md).

---

## Check whether the system changed

The system may have different starting data after an update. Save the results from before and after, then compare them:

```bash
node bin/agent-web.mjs verify cases/memory-demo --adapter=memory --out=before.jsonl
# After the update, run it again and save the results as after.jsonl
node bin/agent-web.mjs verify cases/memory-demo --adapter=memory --out=after.jsonl
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
docs/SPEC.md            Detailed case-file format
test/engine.test.mjs    Automated tests (46 cases)
```

Common commands: `selftest` (run the built-in checks), `verify` (check cases), `compare` (compare systems), `record` (organize request logs), `draft` (make a case draft), `flow` (make a flow chart), and `drift` (compare whether the starting data changed). Run `node bin/agent-web.mjs help` for the full list.

---

## Version and next steps

Current version: `0.5`. It can run cases, check an assistant's actions, organize request logs, create case drafts for review, and generate interactive flow charts.

Next: make it easier for different systems to share the same cases, run tests against multiple systems at once, and turn abilities that are only inferred into abilities that have been verified in practice.

MIT license. See [LICENSE](LICENSE).

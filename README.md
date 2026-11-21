# AgentProof

AI agents say "Done!" when they aren't. AgentProof watches what the agent
actually did and checks the claim.

Gemini 4 NYC Hackathon, Problem Statement One (5 Sigma).

![The lie](docs/the-lie.png)

The agent was asked to buy 2 mugs with code SAVE10. The page says "10%
discount applied" and "order confirmed", and the agent reports success. But the
total is $24.00, not $21.60. The discount was never applied.

## How it works

1. **A browser agent** (Gemini) does shopping tasks in a demo store and reports
   `{success, claim}`.
2. **Some runs have a hidden bug switched on** (wrong total, wrong item, order
   never saved...). The agent doesn't know.
3. **The server logs every real order.** That log is the answer key. The
   verifier never sees it.
4. **AgentProof** gets the screen recording, the claim and (optionally) the
   network log, and decides whether the task really succeeded.

Labels come from the server automatically, so there's no hand labeling, and the
agent's runs are not scripted by us.

## Verifiers compared

| Verifier | What it does |
|---|---|
| `trust` | Believes the agent. What most people do today. |
| `single` | One Gemini call: video + claim -> verdict. |
| `agentproof` | Model 1 (fast) watches the video and writes down what was on screen. Model 2 (strong) works out what the result *should* be and compares. |
| `agentproof+network` | Same, plus the network log. Catches failures the screen hides. |

Metrics: accuracy, **agent lies caught** (agent said success, server says no),
**false alarms** (real success flagged as failure).

## Setup

Needs Node 20+, [ffmpeg](https://ffmpeg.org) on your PATH (`brew install ffmpeg`)
and Playwright's Chromium.

```bash
npm ci
npx playwright install chromium
cp .env.example .env               # key + model IDs (only for real runs)
npm run doctor                     # checks all of the above, says what's missing
```

## Check the plumbing (no API key)

```bash
npm test          # unit tests: ground truth, scoring, server, JSON parsing, retries
npm run smoke     # mock agent on a clean + buggy store, end to end, asserts 1 lie found
npm run check     # both
```

Run `npm run check` before trusting any new numbers. Scripts work from any
directory; outputs always go under the repo root unless you pass `--out` /
`--runs` / `--results`.

## Run

```bash
# Plumbing test, no API key needed:
node agentproof/collect.mjs --mock
node agentproof/eval.mjs --runs runs_mock --verifiers trust --tag mock

# Real thing:
node agentproof/collect.mjs                 # Gemini agent: 6 tasks x 8 bug settings = 48 runs
node agentproof/eval.mjs --tag v1           # all verifiers
# change prompts in agentproof/verifiers.mjs after reading results/v1.md, then:
node agentproof/eval.mjs --tag v2 --redo
```

Start small: `--tasks one_tee,two_mugs_discount --mutants none,discount_not_applied`

Results: `results/<tag>.md`, with a table plus every run a verifier got wrong.
Each run folder in `runs/` has `video.mp4`, `final.png`, `run.json` (claim,
truth, network log) and the verdicts.

Verdicts are cached per run as `verdict.<verifier>.<tag>.json`, together with
the model IDs that produced them. Changing a `MODEL_*` recomputes automatically,
and errored verdicts (rate limit, bad JSON) are retried on the next eval. After
editing a **prompt**, pass `--redo` or use a new `--tag`. Gemini calls retry
with backoff on 429/5xx, so "Errors" in the table means a call failed 4 times.

## Expected story (to confirm with real runs)

- `trust` catches 0 lies.
- Video-only verifiers should catch visible lies (wrong total, wrong item) but
  miss `order_silently_fails`, where the screen says "confirmed" and nothing
  was saved. Even a strong hand-written Playwright test misses that one.
- Adding the network log is the v2 fix for that failure.

## Mock mode

`--mock` runs a scripted agent that always claims success. It only exists to
test the plumbing. **Never report mock numbers as results.** The real eval uses
the Gemini agent, whose behavior we don't script.

## How the pieces connect

```
agentproof/tasks.json ─┐
                       ├─> collect.mjs ──> runs/<task>__<bug>/ ──> eval.mjs ──> results/<tag>.md
app/ (store + 1 bug) ──┘    (agent shops,   video.mp4, final.png,    (verifiers judge each run,
                             server logs     run.json: claim, truth,  scored against the
                             real orders)    network log              server's order log)
```

The verifiers only see the video, screenshot, claim and (for
`agentproof+network`) the network log. The server's order log in `run.json` is
the answer key, used only to score them.

## Files

```
app/                   the demo store and the answer key
  index.html           the store, with 11 bugs that can be switched on
  mutants.json         the bug list
  server.mjs           serves the store, logs every real order (ground truth)
agentproof/            the product: run agents, check claims, score the checkers
  tasks.json           6 shopping tasks + expected orders
  tasks.mjs            loads tasks / mutants, rejects unknown names
  truth.mjs            ground truth: does the logged order match the task?
  agent.mjs            the agent being checked (Gemini browser loop) + mock
  collect.mjs          runs agent x bugs, records video + network + truth
  verifiers.mjs        trust / single / agentproof / agentproof+network
  metrics.mjs          accuracy, lies caught, false alarms
  eval.mjs             scores verifiers against truth
  managed.mjs          same as collect, with a Gemini Managed Agent
  managed-lib.mjs      parses the managed agent's claim and HAR network log
src/                   shared code
  gemini.mjs           Gemini SDK wrapper: retries, JSON parsing, model IDs from .env
  paths.mjs            repo-root paths (scripts work from any directory)
  cli.mjs              strict argument parsing (typos are errors)
  media.mjs            ffmpeg helpers
test/                  unit tests (node --test, no API key, no browser)
scripts/
  smoke.mjs            end-to-end mock run
  doctor.mjs           setup check
rec2test/              the earlier fallback idea (see below)
docs/                  images for this README
```

Generated when you run things (git-ignored):

```
runs/                  collect.mjs output, one folder per task x bug:
  <task>__<bug>/         video.mp4, raw.webm, final.png, step_<n>.png,
                         run.json (claim, truth, network, orders),
                         verdict.<verifier>.<tag>.json (cached verdicts)
runs_mock/             same, from --mock (plumbing only, never report these)
runs_managed/          same, from managed.mjs (+ session.har, interaction.json)
results/<tag>.md       eval.mjs report: score table + every run a verifier got wrong
rec2test/out/<tag>/    rec2test generated tests and scores
```

## Fallback: rec2test

Same repo also holds the earlier idea (recording -> Playwright test, scored by
mutation testing), all under `rec2test/`. Put recordings in
`rec2test/recordings/*.mp4`, then `npm run rec2test`; results go to
`rec2test/out/<tag>/`. `npm run sanity` (no API key) checks the mutation
harness: the strong reference test kills 10/11 mutants, the weak one 0/11.

## Gemini Managed Agent (Best Managed Agents award)

The agent being checked can be a Gemini Managed Agent instead of the simple loop.
It runs in Google's cloud, so expose the store with a tunnel:

```bash
npx cloudflared tunnel --url http://localhost:4000          # terminal 1, copy the https URL
PUBLIC_URL=https://xxxx.trycloudflare.com \
  node agentproof/managed.mjs --tasks two_mugs_discount --mutants none,discount_not_applied   # terminal 2
node agentproof/eval.mjs --runs runs_managed --tag managed_v1
```

The managed agent records its own video, screenshots and HAR in its sandbox and
uploads them to `/__evidence/` on the store. Ground truth still comes from the
store's order log, which the agent and the verifiers never see.

Check the Interactions API request/response fields in `managed.mjs` against
Builder Resources before the first run.

## Prior work (disclosure)

Built before the hackathon started on Nov 21: the demo store and bugs, the
mutation-testing harness (rec2test), and first versions of the agent runner,
verifiers and eval scripts. Everything after the first commit was built at the event.

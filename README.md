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

## Run

```bash
npm install
npx playwright install chromium
cp .env.example .env               # key + model IDs

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

## Files

```
app/                 demo store, 11 injectable bugs, order log (ground truth)
agentproof/
  tasks.json         6 shopping tasks + expected orders
  agent.mjs          the agent being checked (Gemini browser loop) + mock
  collect.mjs        runs agent x bugs, records video + network + truth
  verifiers.mjs      trust / single / agentproof / agentproof+network
  eval.mjs           scores verifiers against truth
src/gemini.mjs       Gemini SDK wrapper, model IDs from .env
```

## Fallback: rec2test

Same repo also holds the earlier idea (recording -> Playwright test, scored by
mutation testing): `src/systems.mjs`, `src/eval.mjs`, `npm run sanity`.

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

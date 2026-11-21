// Keep prompts in one place so you can iterate on them after reading failures.

export const TEST_RULES = `
Output a single Playwright Test file in TypeScript.
- import { test, expect } from '@playwright/test'
- Start with: await page.goto('/')
- Prefer getByTestId / getByRole selectors that exist in the DOM provided.
- Every user action must be followed by at least one expect() that checks the
  visible outcome (text, count, value, enabled/disabled, visibility).
- Check exact values the user saw (totals, quantities, messages), not just
  that an element exists.
- Do not use waitForTimeout. Use web-first assertions which auto-wait.
- Return only the code in one \`\`\`ts block.
`;

export const BASELINE_PROMPT = dom => `
You are given a screen recording of a user using a web app, and the app's HTML.
Write a Playwright end-to-end test that reproduces what the user did and checks
the app behaved correctly.
${TEST_RULES}
App HTML:
${dom}
`;

export const PERCEIVE_PROMPT = `
Watch this screen recording of a web app. List every user action in order.
For each action return:
- t: timestamp in seconds when the action happens (the click or keypress)
- action: click | type | select | scroll | other
- target: what was interacted with, in plain words (e.g. "Add to cart button for T-Shirt")
- value: text typed, if any
- visible_change: what changed on screen right after (e.g. "total went from $12.00 to $32.00")
Ignore mistakes the user corrected (misclick then undo) only if the net effect is nothing;
otherwise keep them, because the test should reproduce what really happened.
Return JSON: {"steps":[{"t":0,"action":"","target":"","value":"","visible_change":""}]}
`;

export const AUTHOR_PROMPT = (steps, dom) => `
You are writing a Playwright regression test from a screen recording.
You have: (1) the list of steps another model extracted from the video,
(2) for each step, a BEFORE and AFTER screenshot, in order, (3) the app HTML.
Use the screenshots to read the exact values on screen after each step and
assert them. If a screenshot contradicts the step list, trust the screenshot.
${TEST_RULES}
Steps:
${JSON.stringify(steps, null, 2)}

App HTML:
${dom}
`;

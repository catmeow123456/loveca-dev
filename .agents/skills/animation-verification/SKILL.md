---
name: animation-verification
description: Loveca animation and interaction verification workflow. Use when validating battle desktop animations, drag/drop behavior, active-effect UI, inspection/reveal flows, LIVE resolution feedback, responsive layout, reduced-motion behavior, or visual regressions with Playwright, screenshots, and focused checks.
---

# Animation Verification

## Purpose

Verify visible battle UI work with evidence, not just TypeScript success. Use real browser checks for any change that affects animation, layout, drag/drop, selection, active-effect panels, hidden-information display, or mobile/desktop board fit.

Prefer the global `playwright` or `playwright-interactive` skills when available. Use the global `screenshot` skill for OS-level capture only when browser screenshots are not enough.

## QA Inventory First

Before testing, write a short inventory:

- User-visible claims you intend to make in the final response.
- Controls and interactions changed by the task.
- State changes each control can cause.
- At least one functional check and one visual check for each claim or interaction.
- Two off-happy-path checks for fragile flows, such as stale selection, illegal drop, no legal targets, reduced-motion mode, or opponent hidden view.

## Environment

- Prefer the project test environment when a real battle flow is needed: `pnpm test-env:start`.
- The usual local page is `http://localhost:5173/` or `http://127.0.0.1:5173/`.
- Use `output/playwright/` for browser artifacts committed only when explicitly useful. Do not add new top-level artifact folders.
- When a dev server is already running, reuse it unless its state blocks the test.

## Browser Checks

Run checks at the smallest scope that proves the claim:

- Desktop board: 1600x900 or a comparable wide viewport.
- Mobile/narrow board: about 390x844 for fit and overlap checks.
- Reduced motion: emulate `prefers-reduced-motion: reduce` when the task adds or changes motion.
- Hidden information: verify both acting-player and opponent-visible projections when inspection, hand, deck, or revealed state is involved.
- End state: after every animation, assert the card, zone, orientation, panel, or selected state has settled correctly.

## What To Verify

- Drag/drop: drag preview follows pointer, legal targets highlight, illegal target rejects without state mutation, final state matches command result.
- Card movement: source and destination are clear, no card disappears mid-transition, and z-index does not cover important controls.
- Orientation: active/waiting visual state is distinct before and after animation.
- Active effect: source, effect text, candidate grid, confirm/skip controls, and hover detail are all readable and non-overlapping.
- Inspection/reveal: private inspect, public reveal, selected reveal, and move-to-hand/waiting-room steps preserve visibility rules.
- Pending queue: multiple pending abilities remain distinguishable, especially same-source multiple LIVE_START abilities.
- LIVE resolution: score, Heart, BLADE, requirement modifiers, success/failure, and manual override controls remain coherent.
- Responsive fit: board zones, effect panels, hover cards, toolbars, and buttons do not overlap or crop text.

## Standard Commands

Use code checks appropriate to the change:

```bash
pnpm --dir client exec tsc -b
pnpm exec tsc --noEmit
git diff --check
```

Add focused unit/integration tests when the task changes command behavior, card effect state, projection, visibility, or rule semantics. Pure CSS-only motion changes usually need browser evidence more than new unit tests.

## Evidence

- Capture before/during/after screenshots when judging animation or layout.
- Capture at least one settled-state screenshot for final claims.
- For hard-to-reproduce interaction bugs, keep a Playwright trace or concise reproduction commands.
- In the final response, state exactly which commands and browser checks ran. If browser verification was skipped, say why.

## Failure Rules

- Treat text overlap, clipped buttons, hidden controls under overlays, blank card images where assets should render, and incorrect final state as blockers.
- Treat inaccessible hidden information as a correctness issue, not a visual nit.
- Do not accept an animation that only looks correct at one viewport if the board is meant to support both desktop and mobile/narrow views.
- If a Playwright ref goes stale, resnapshot before continuing.

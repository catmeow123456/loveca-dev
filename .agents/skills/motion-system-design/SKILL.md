---
name: motion-system-design
description: Loveca battle motion design guidance. Use when designing or implementing card movement, flip, tap/orientation, zone transfer, inspection, active-effect, LIVE resolution, cheer, cost payment, drag/drop, or other animated feedback in the Loveca battle desktop or shared game board UI.
---

# Motion System Design

## Purpose

Design motion as rule feedback, not decoration. Every animation should make the current authoritative game transition easier to understand, while preserving the Loveca priority of "rules correct + player-view testable".

Use this together with `frontend-design` for visual quality and `battle-interaction-design` when the task changes controls, command flow, or error states.

## Ground Rules

- Keep authoritative state changes in `GameSession` / `GameService` / command flow. React animation state may visualize transitions, but must not become a hidden rules source.
- Reuse `GameBoard` / `PlayerArea` and shared card components. Do not create a separate "test desktop" animation path.
- Animate from state deltas, command results, event logs, or projected view state. Avoid hard-coding specific card effects in React.
- Preserve hidden information. If a card is not visible through `projector` / visibility / inspection context, do not reveal it with a flip, preview, trail, or intermediate frame.
- Motion must finish in the exact rendered state implied by the authoritative state. If animation fails, the final layout must still be correct.
- Support `prefers-reduced-motion: reduce` with either instant transitions or very short opacity/position changes. Never make reduced motion harder to follow.

## Motion Vocabulary

- Card movement: use for actual zone/slot movement, such as hand to stage, stage to waiting room, deck to inspection, inspection to hand, energy payment, or LIVE/cheer resolution.
- Orientation change: use rotation or clear state change for active/waiting. Keep it fast and readable; it should not look like a zone move.
- Flip/reveal: reserve for information state changes. Public reveal, private inspect, and opponent-hidden cards need distinct visual treatment.
- Source emphasis: use a short pulse or outline on the source card for triggered effects, pending abilities, and active-effect resolution.
- Legal-target emphasis: use stable highlights for drop targets or selectable cards. Do not animate illegal targets into looking clickable.
- Queue sequencing: when multiple abilities are pending, motion should help identify source, selected ability, and resolved outcome without forcing a long cinematic.
- LIVE flow: distinguish "LIVE opened", "LIVE start effects", "cheer/reveal", "judgment", and "success effects". These are rule moments, not one merged animation.

## Timing

- Micro feedback: 80-140ms for hover, press, enabled/disabled, and target highlight changes.
- Card move or orientation change: 140-260ms for one visible object.
- Multi-card fan or reveal: 180-320ms total unless user confirmation is required.
- Effect source pulse: 220-420ms, then settle into a stable selected/processing state.
- Avoid blocking chains longer than about 600ms unless the player explicitly triggered a batch reveal or confirmation step.
- Use consistent easing within a flow. Prefer direct, legible movement over elastic or playful easing in rule-critical moments.

## Design Workflow

1. Identify the rule event: command, phase transition, card effect step, inspection reveal, pending ability, LIVE resolution, or manual table action.
2. Identify the player's question: "what moved?", "why is this enabled?", "what must I choose?", "what changed after confirmation?", or "what is hidden from me?"
3. Choose one primary motion cue. Do not stack movement, glow, scale, shake, and copy text for the same fact.
4. Define final state before animation details. The animation can be skipped and the UI must still communicate the same state.
5. Check overlap and z-index. Moving cards, drag overlays, effect panels, hover detail, and inspection grids must not fight for the same layer.
6. Add reduced-motion behavior in the same change when practical.
7. Verify with screenshots or Playwright when the change is visible or interactive.

## Loveca-Specific Patterns

- Playing a member: show hand-to-stage movement, then energy cost feedback if cost is paid automatically. Do not require a confirm window for ordinary play.
- Paying energy: indicate the first active energy cards being tapped or consumed by rule order. Energy has no individual strategic choice unless the rule adds one.
- Discarding hand for an effect: keep the active effect panel and hand selection visually connected. The skip button wording remains "不发动" for optional costs.
- Inspection: move cards into an inspection surface first. Public reveal shows face-up to both players; private inspect keeps opponent visibility masked.
- Publicly chosen card: show selected card as revealed before moving to hand if the text says "公开并加入手牌".
- Pending ability: emphasize the source card and effect text. For confirm-only effects, do not animate resolution until the player confirms.
- Position change: show source slot, destination slot, and any swap. Do not treat initial entry to stage as position movement.
- LIVE modifiers: show added score, Heart, BLADE, or requirement changes near the LIVE/judgment area, not as generic global toasts.

## Implementation Notes

- Prefer CSS transitions or focused motion primitives near the component that owns the view state. Add a shared helper only when multiple flows need the same state mapping.
- Keep animation props explicit: `isMoving`, `isRevealed`, `effectVisualState`, `dropState`, or similarly narrow names are easier to audit than broad "variant" flags.
- Avoid layout-shifting animations for fixed board elements. Use transform/opacity where possible and reserve stable dimensions for cards, zones, counters, and toolbars.
- Do not use full-screen decorative effects for normal rule transitions. The game board should remain scannable during repeated play.

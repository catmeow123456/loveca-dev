---
name: battle-interaction-design
description: Loveca battle interaction design guidance. Use when designing or changing player actions, drag/drop, selectable targets, pending ability ordering, active-effect panels, inspection flows, hidden-information visibility, undo, local test desktop behavior, online battle views, or error feedback in the shared battle UI.
---

# Battle Interaction Design

## Purpose

Design interactions from the player's current legal choices back to the command model. The UI should make legal actions discoverable, illegal actions understandable, and rule outcomes auditable.

Use this with `motion-system-design` when the interaction needs animation and with `frontend-design` when the change affects layout, controls, or information hierarchy.

## Ground Rules

- Route rule-changing actions through `GameSession` / `GameService` / commands. React components should not directly mutate authoritative state.
- Keep local test and formal web battle on shared `GameBoard` / `PlayerArea` paths unless there is an explicit product boundary.
- Do not hard-code specific card effects in React. Card effect choices should come from `activeEffect`, pending ability state, definitions, projector output, or command capability data.
- Preserve hidden information through projection and inspection context. Never let hover, disabled text, animation, DOM labels, or screenshots reveal private cards to the wrong player.
- Favor player-view testability. If a state is legal but hard to discover, add a visible affordance instead of relying on memory.
- Prefer stable, specific controls: icon buttons for tools, toggles for binary state, segmented controls for modes, card grids for card choices, and explicit buttons for rule confirmations.

## Interaction Workflow

1. Identify the acting player and view context: local tester, active player, waiting player, projected opponent view, or online participant.
2. List legal intents before designing controls: play, replace, tap, move, inspect, select target, pay cost, confirm, skip, undo, accept judgment, or adjust test-only state.
3. Map each intent to one command or active-effect resolution path. If no command exists, add it at the proper application layer before adding UI.
4. Define visible states: available, hover/focus, dragging, legal target, illegal target, selected, pending confirmation, resolving, rejected, and completed.
5. Define blocked behavior. Disabled controls need a useful reason or should be hidden if the action is irrelevant.
6. Verify that the same interaction works in the shared board path and does not leak hidden information through the opponent projection.

## Loveca Interaction Patterns

- Drag/drop: highlight legal zones before drop, keep drag preview readable, and reject illegal drops without moving authoritative state.
- Manual tap/orientation: expose as a clear member interaction only in legal windows. Distinguish player action from rule or card-effect orientation changes in state/event flow.
- Active effects: show source card, full effect text where practical, current step, candidate card grid, and the exact confirm/skip command.
- Pending ability order: when multiple effects share timing, show each source/effect as a distinct option. If one source has multiple abilities, use effect text to disambiguate.
- Confirm-only effects: require a deliberate "继续处理" style action before resolving when the player manually selects the pending ability.
- Optional costs: the skip button is "不发动"; selection copy for hand discard is "请选择要放置入休息室的卡牌".
- Inspection: prefer card art grids with hover detail. Do not replace card choices with text-only buttons unless no card art is available.
- Undo: treat undo as local/debug broad one-step undo. Do not imply it is available for remote battles unless the remote agreement model exists.
- Test-only controls: keep them visually separate from player rules actions so testers do not mistake debug adjustments for legal play.

## Hidden Information Checklist

- Can the acting player see the card identity at this moment?
- Can the opponent see it, or only know a card count?
- Does hover detail follow the same visibility rule?
- Does animation briefly show a face that should be hidden?
- Does the active-effect panel include card names that should be private?
- Do Playwright snapshots or accessible labels reveal hidden card identity in an opponent view?

## Error And Feedback Rules

- Prefer inline, local feedback near the attempted action over global toasts for rule rejections.
- For command rejection, keep the board in the last authoritative state and clear transient drag/selection state.
- For multi-step effects, stale selections must be cleared when step id, candidate set, or selection mode changes.
- If an operation has no legal targets but still legally resolves, show a confirm-only step or clear "no target" completion rather than blocking the player.
- Keep wording direct and rule-facing. Do not add explanatory flavor text to card effects.

## Implementation Targets

- Main desktop: `client/src/components/game/GameBoard.tsx`
- Player zones: `client/src/components/game/PlayerArea.tsx`
- Frontend store: `client/src/store/gameStore.ts`
- Projection boundary: `src/online/projector.ts`
- Authoritative command flow: `src/application/game-session.ts`
- Rule service: `src/application/game-service.ts`
- Card effect runner: `src/application/card-effect-runner.ts`

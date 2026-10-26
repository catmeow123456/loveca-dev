import type { GameSession } from '../../src/application/game-session';
import {
  addAction,
  updatePlayer,
  type ActiveEffectState,
  type GameState,
} from '../../src/domain/entities/game';
import { registerActiveEffectStepHandler } from '../../src/application/card-effects/runtime/step-registry';
import { ABILITY_ORDER_SELECTION_ID } from '../../src/application/card-effect-runner';
import { SlotPosition, TriggerCondition, ZoneType } from '../../src/shared/types/enums';
import {
  attachPublicRevealAutoAdvanceAuthority,
  createPublicRevealDwellBeforeNextEffect,
} from '../../src/application/card-effects/runtime/public-reveal-dwell';
import { prepareRecoveryScenario } from './recovery-animation-fixture';

export type EffectDisplayScene =
  'reveal-mixed' | 'reveal-live' | 'ordered-result' | 'legacy' | 'single' | 'order';

/** Seed initial positions only; the shared board executes selection and timed continuation commands. */
export function preparePublicEffectDisplayScenario(
  session: GameSession,
  scene: EffectDisplayScene
) {
  const base = prepareRecoveryScenario('multiple', session);
  let state = session.state!;
  const abilityId = `test:effect-display:${scene}`;
  const stepId = 'SELECT';
  const nextEffect: ActiveEffectState = {
    id: abilityId,
    abilityId,
    stepId,
    controllerId: 'p1',
    awaitingPlayerId: 'p1',
    sourceCardId: 'source',
    effectText: '选择一张卡牌和要处理的效果。',
    stepText: '请选择要处理的卡牌与效果。',
    selectionLabel: '选择要处理的手牌',
  };
  registerActiveEffectStepHandler(abilityId, stepId, (game, input) =>
    addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', 'p1', {
      selectedCardId: input.selectedCardId,
      selectedOptionId: input.selectedOptionId,
      selectedEffectOptionIds: input.selectedEffectOptionIds,
    })
  );

  if (scene === 'ordered-result') {
    // Use the real discard/recover workflow to enter its public confirmation.
    for (let i = 0; i < 2; i++) {
      const result = session.executeCommand(base.nextCommand());
      if (!result.success) throw new Error(result.error);
    }
    state = session.state!;
    if (!state.activeEffect?.publicCardSelectionAutoAdvanceAt)
      throw new Error('Missing public confirmation');
    // This fixture also exercises the optional order labels on the projected result.
    state = { ...state, activeEffect: { ...state.activeEffect, publicCardSelectionOrdered: true } };
  } else if (scene.startsWith('reveal-')) {
    const revealedCardIds =
      scene === 'reveal-live' ? ['recover-a', 'waiting-live-2'] : ['recover-a', 'recover-b'];
    const inspected = [...revealedCardIds, 'hand-0'];
    state = updatePlayer(state, 'p1', (player) => ({
      ...player,
      hand: {
        ...player.hand,
        cardIds: player.hand.cardIds.filter((id) => !inspected.includes(id)),
      },
      waitingRoom: {
        ...player.waitingRoom,
        cardIds: player.waitingRoom.cardIds.filter((id) => !inspected.includes(id)),
      },
    }));
    state = attachPublicRevealAutoAdvanceAuthority(
      createPublicRevealDwellBeforeNextEffect(
        {
          ...state,
          pendingAbilities: [],
          inspectionContext: { ownerPlayerId: 'p1', sourceZone: ZoneType.MAIN_DECK },
          inspectionZone: { ...state.inspectionZone, cardIds: inspected, revealedCardIds },
        },
        {
          ...nextEffect,
          selectableCardIds: inspected,
          selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
          inspectionCardIds: inspected,
          revealedCardIds,
        },
        { revealedCardIds }
      ),
      Date.now(),
      () => `fixture-${scene}`
    );
  } else if (scene === 'order') {
    const original = state.activeEffect!;
    const pending = {
      abilityId: original.abilityId,
      sourceCardId: original.sourceCardId,
      controllerId: 'p1',
      mandatory: true,
      eventIds: [],
      sourceSlot: SlotPosition.CENTER,
      timingId: TriggerCondition.ON_ENTER_STAGE,
    };
    const pendingAbilities = ['first', 'second'].map((suffix) => ({
      ...pending,
      id: `display-order-${suffix}`,
    }));
    state = {
      ...state,
      pendingAbilities,
      activeEffect: {
        ...nextEffect,
        id: 'display-order',
        abilityId: ABILITY_ORDER_SELECTION_ID,
        stepId: 'SELECT_PENDING_ABILITY',
        selectionLabel: '请选择下一个要处理的效果',
        canResolveInOrder: true,
        selectableOptions: pendingAbilities.map((pending, index) => ({
          id: pending.id,
          label: `第${index + 1}项：${'选择接下来要处理的效果。'.repeat(5)}`,
        })),
        metadata: {
          pendingAbilityIds: pendingAbilities.map((pending) => pending.id),
          usesAbilityOptions: true,
        },
      },
    };
  } else {
    state = {
      ...state,
      pendingAbilities: [],
      activeEffect: {
        ...nextEffect,
        selectableCardIds: ['hand-0', 'hand-1'],
        canSkipSelection: true,
        skipSelectionLabel: '不发动',
        ...(scene === 'legacy'
          ? {
              selectableOptions: Array.from({ length: 6 }, (_, index) => ({
                id: `choice-${index}`,
                label: `第${index + 1}项：${'处理所选卡牌的效果。'.repeat(3)}`,
              })),
            }
          : {
              effectChoice: {
                mode: 'SINGLE' as const,
                minSelections: 1,
                maxSelections: 1,
                publicConfirmation: true,
                options: [
                  { id: 'first', text: '处理第1项效果。' },
                  { id: 'second', text: '处理第2项效果。', selectable: false },
                ],
              },
            }),
      },
    };
  }
  (session as unknown as { authorityState: GameState }).authorityState = state;
  return { cardData: base.cardData };
}

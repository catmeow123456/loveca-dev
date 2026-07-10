import { describe, expect, it } from 'vitest';
import type { LiveCardData, MemberCardData } from '../../src/domain/entities/card';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
} from '../../src/domain/entities/card';
import {
  createGameState,
  emitGameEvent,
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import { createLeaveStageEvent } from '../../src/domain/events/game-events';
import {
  confirmActiveEffectStep,
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { S_BP2_002_ON_LEAVE_STAGE_DISCARD_RECOVER_AQOURS_LIVE_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import { CardType, HeartColor, SlotPosition, TriggerCondition, ZoneType } from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function member(cardCode: string, groupNames: readonly string[] = ['Aqours']): MemberCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames,
    cardType: CardType.MEMBER,
    cost: 4,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.RED, 1)],
  };
}

function live(cardCode: string, groupNames: readonly string[] = ['Aqours']): LiveCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames,
    cardType: CardType.LIVE,
    score: 4,
    requirements: createHeartRequirement({ [HeartColor.RED]: 1 }),
  };
}

function resolve(game: GameState): GameState {
  return resolvePendingCardEffects(game).gameState;
}

function confirm(
  game: GameState,
  selectedCardId?: string | null,
  selectedCardIds?: readonly string[]
): GameState {
  return game.activeEffect?.selectableCardMode === 'ORDERED_MULTI'
    ? confirmActiveEffectStep(
        game,
        PLAYER1,
        game.activeEffect.id,
        null,
        null,
        false,
        null,
        selectedCardIds ?? (selectedCardId ? [selectedCardId] : [])
      )
    : confirmActiveEffectStep(game, PLAYER1, game.activeEffect!.id, selectedCardId);
}

function setup(options: {
  readonly handCards: readonly ReturnType<typeof createCardInstance>[];
  readonly waitingCards?: readonly ReturnType<typeof createCardInstance>[];
}): { readonly game: GameState; readonly sourceId: string } {
  const source = createCardInstance(member('PL!S-bp2-002-P'), PLAYER1, 'bp2-002-source');
  const allCards = [source, ...options.handCards, ...(options.waitingCards ?? [])];
  let game = registerCards(
    createGameState('grouped-recovery-bp2-002', PLAYER1, 'P1', PLAYER2, 'P2'),
    allCards
  );
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    hand: { ...player.hand, cardIds: options.handCards.map((card) => card.instanceId) },
    waitingRoom: {
      ...player.waitingRoom,
      cardIds: [source.instanceId, ...(options.waitingCards ?? []).map((card) => card.instanceId)],
    },
  }));
  const event = createLeaveStageEvent(
    source.instanceId,
    SlotPosition.CENTER,
    ZoneType.WAITING_ROOM,
    PLAYER1,
    PLAYER1
  );
  game = enqueueTriggeredCardEffects(emitGameEvent(game, event), [TriggerCondition.ON_LEAVE_STAGE], {
    leaveStageEvents: [event],
  });
  return { game: resolve(game), sourceId: source.instanceId };
}

describe('grouped recovery: PL!S-bp2-002 桜内梨子', () => {
  it('opens a private optional discard window after the member leaves the stage and can decline', () => {
    const discard = createCardInstance(member('PL!S-test-hand', ['Liella!']), PLAYER1, 'discard');
    const { game } = setup({ handCards: [discard] });

    expect(game.activeEffect).toMatchObject({
      abilityId: S_BP2_002_ON_LEAVE_STAGE_DISCARD_RECOVER_AQOURS_LIVE_ABILITY_ID,
      stepId: 'S_BP2_002_SELECT_DISCARD_FOR_AQOURS_LIVE_RECOVERY',
      selectableCardIds: [discard.instanceId],
      selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
    });

    const declined = confirm(game, null);
    expect(declined.activeEffect).toBeNull();
    expect(declined.players[0].hand.cardIds).toEqual([discard.instanceId]);
    expect(declined.pendingAbilities).toEqual([]);
  });

  it('discards through the waiting-room trigger path and must recover one Aqours LIVE when available', () => {
    const discard = createCardInstance(member('PL!S-test-discard', ['Liella!']), PLAYER1, 'discard');
    const target = createCardInstance(live('PL!S-test-aqours-live'), PLAYER1, 'aqours-live');
    const wrongLive = createCardInstance(live('PL!S-test-other-live', ['Liella!']), PLAYER1, 'other-live');
    const wrongMember = createCardInstance(member('PL!S-test-aqours-member'), PLAYER1, 'aqours-member');
    const { game } = setup({ handCards: [discard], waitingCards: [target, wrongLive, wrongMember] });

    const afterDiscard = confirm(game, discard.instanceId);
    expect(afterDiscard.activeEffect).toMatchObject({
      stepId: 'S_BP2_002_SELECT_AQOURS_LIVE_FROM_WAITING_ROOM',
      selectableCardIds: [target.instanceId],
      selectableCardVisibility: 'PUBLIC',
      minSelectableCards: 1,
      maxSelectableCards: 1,
      canSkipSelection: false,
    });
    expect(afterDiscard.players[0].waitingRoom.cardIds).toContain(discard.instanceId);
    expect(
      afterDiscard.eventLog.some(
        (entry) =>
          entry.event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM &&
          entry.event.cardInstanceId === discard.instanceId
      )
    ).toBe(true);

    const recovered = confirm(afterDiscard, target.instanceId);
    expect(recovered.activeEffect).toBeNull();
    expect(recovered.pendingAbilities).toEqual([]);
    expect(recovered.players[0].hand.cardIds).toEqual([target.instanceId]);
    expect(recovered.players[0].waitingRoom.cardIds).toContain(discard.instanceId);
  });

  it('can recover an Aqours LIVE just discarded, but keeps a non-Aqours discard paid when no target remains', () => {
    const discardedLive = createCardInstance(live('PL!S-test-discarded-live'), PLAYER1, 'discarded-live');
    const recoverable = setup({ handCards: [discardedLive] });
    const afterDiscard = confirm(recoverable.game, discardedLive.instanceId);
    expect(afterDiscard.activeEffect?.selectableCardIds).toEqual([discardedLive.instanceId]);
    expect(confirm(afterDiscard, discardedLive.instanceId).players[0].hand.cardIds).toEqual([
      discardedLive.instanceId,
    ]);

    const nonAqoursDiscard = createCardInstance(
      member('PL!S-test-non-aqours', ['Liella!']),
      PLAYER1,
      'non-aqours-discard'
    );
    const noTarget = setup({ handCards: [nonAqoursDiscard] });
    const resolved = confirm(noTarget.game, nonAqoursDiscard.instanceId);
    expect(resolved.activeEffect).toBeNull();
    expect(resolved.pendingAbilities).toEqual([]);
    expect(resolved.players[0].waitingRoom.cardIds).toContain(nonAqoursDiscard.instanceId);
  });

  it('does not consume the window or move cards for illegal or duplicate recovery input', () => {
    const discard = createCardInstance(member('PL!S-test-discard', ['Liella!']), PLAYER1, 'discard');
    const target = createCardInstance(live('PL!S-test-aqours-live'), PLAYER1, 'aqours-live');
    const { game } = setup({ handCards: [discard], waitingCards: [target] });
    const recovery = confirm(game, discard.instanceId);

    expect(confirm(recovery, discard.instanceId)).toBe(recovery);
    expect(confirm(recovery, null, [target.instanceId, target.instanceId])).toBe(recovery);
  });

  it('refreshes the mandatory recovery window when the submitted stale target has another legal replacement', () => {
    const discard = createCardInstance(member('PL!S-test-discard', ['Liella!']), PLAYER1, 'discard');
    const staleTarget = createCardInstance(live('PL!S-test-stale-live'), PLAYER1, 'stale-live');
    const replacementTarget = createCardInstance(
      live('PL!S-test-replacement-live'),
      PLAYER1,
      'replacement-live'
    );
    const { game } = setup({ handCards: [discard], waitingCards: [staleTarget, replacementTarget] });
    const recovery = confirm(game, discard.instanceId);
    const stale = updatePlayer(recovery, PLAYER1, (player) => ({
      ...player,
      waitingRoom: {
        ...player.waitingRoom,
        cardIds: player.waitingRoom.cardIds.filter((cardId) => cardId !== staleTarget.instanceId),
      },
    }));
    const refreshed = confirm(stale, staleTarget.instanceId);

    expect(refreshed.activeEffect).toMatchObject({
      stepId: 'S_BP2_002_SELECT_AQOURS_LIVE_FROM_WAITING_ROOM',
      selectableCardIds: [replacementTarget.instanceId],
      minSelectableCards: 1,
      maxSelectableCards: 1,
      canSkipSelection: false,
    });
    expect(refreshed.activeEffect?.metadata?.requiredGroupKeys).toEqual(['aqoursLive']);
    expect(refreshed.pendingAbilities).toEqual([]);
  });

  it('keeps the discard paid and continues when a submitted stale target leaves no legal recovery target', () => {
    const discard = createCardInstance(member('PL!S-test-discard', ['Liella!']), PLAYER1, 'discard');
    const staleTarget = createCardInstance(live('PL!S-test-stale-live'), PLAYER1, 'stale-live');
    const { game } = setup({ handCards: [discard], waitingCards: [staleTarget] });
    const recovery = confirm(game, discard.instanceId);
    const stale = updatePlayer(recovery, PLAYER1, (player) => ({
      ...player,
      waitingRoom: {
        ...player.waitingRoom,
        cardIds: player.waitingRoom.cardIds.filter((cardId) => cardId !== staleTarget.instanceId),
      },
    }));
    const resolved = confirm(stale, staleTarget.instanceId);

    expect(resolved.activeEffect).toBeNull();
    expect(resolved.pendingAbilities).toEqual([]);
    expect(resolved.players[0].waitingRoom.cardIds).toContain(discard.instanceId);
  });
});

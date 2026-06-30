import { describe, expect, it } from 'vitest';
import type { MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import { addCardToZone, placeCardInSlot } from '../../src/domain/entities/zone';
import {
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { GameService } from '../../src/application/game-service';
import { addLiveModifier } from '../../src/domain/rules/live-modifiers';
import { SP_BP2_010_LIVE_START_OTHER_MEMBER_CHEER_COUNT_MINUS_EIGHT_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import {
  CardType,
  GamePhase,
  HeartColor,
  SlotPosition,
  SubPhase,
  TriggerCondition,
} from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

interface AutoCheerService {
  autoRevealPerformanceCheer(game: GameState, playerId: string): GameState;
}

function createMember(options: {
  readonly cardCode: string;
  readonly instanceId: string;
  readonly name?: string;
  readonly blade?: number;
}): ReturnType<typeof createCardInstance<MemberCardData>> {
  return createCardInstance(
    {
      cardCode: options.cardCode,
      name: options.name ?? options.cardCode,
      groupNames: ['Liella!'],
      cardType: CardType.MEMBER,
      cost: 15,
      blade: options.blade ?? 0,
      hearts: [createHeartIcon(HeartColor.PURPLE, 1)],
    },
    PLAYER1,
    options.instanceId
  );
}

function createMargarete(instanceId: string, blade: number) {
  return createMember({
    cardCode: 'PL!SP-bp2-010-R＋',
    instanceId,
    name: 'ウィーン・マルガレーテ',
    blade,
  });
}

function createPlainMember(instanceId: string, name = 'Other Member') {
  return createMember({
    cardCode: `PL!SP-test-${instanceId}`,
    instanceId,
    name,
    blade: 0,
  });
}

function createDeckCard(index: number) {
  return createMember({
    cardCode: `PL!SP-test-cheer-${index}`,
    instanceId: `cheer-${index}`,
    name: `Cheer ${index}`,
    blade: 0,
  });
}

function setupGame(options: {
  readonly sourceBlade: number;
  readonly otherMember?: ReturnType<typeof createMember>;
  readonly deckCount?: number;
}): {
  readonly game: GameState;
  readonly source: ReturnType<typeof createMargarete>;
  readonly otherMember: ReturnType<typeof createMember> | null;
  readonly deckCards: readonly ReturnType<typeof createDeckCard>[];
} {
  const source = createMargarete('source-margarete', options.sourceBlade);
  const otherMember = options.otherMember ?? null;
  const deckCards = Array.from({ length: options.deckCount ?? 12 }, (_, index) =>
    createDeckCard(index)
  );
  let game = createGameState('sp-bp2-010-margarete', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [source, ...(otherMember ? [otherMember] : []), ...deckCards]);
  game = updatePlayer(game, PLAYER1, (player) => {
    let memberSlots = placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId);
    if (otherMember) {
      memberSlots = placeCardInSlot(memberSlots, SlotPosition.LEFT, otherMember.instanceId);
    }
    return {
      ...player,
      memberSlots,
      mainDeck: deckCards.reduce(
        (zone, card) => addCardToZone(zone, card.instanceId),
        player.mainDeck
      ),
    };
  });
  return { game, source, otherMember, deckCards };
}

function resolveLiveStart(game: GameState): GameState {
  const queued = enqueueTriggeredCardEffects(
    {
      ...game,
      liveResolution: {
        ...game.liveResolution,
        performingPlayerId: PLAYER1,
      },
    },
    [TriggerCondition.ON_LIVE_START]
  );
  return resolvePendingCardEffects(queued).gameState;
}

function autoRevealCheer(game: GameState): GameState {
  const service = new GameService() as unknown as AutoCheerService;
  return service.autoRevealPerformanceCheer(game, PLAYER1);
}

function cheerCountModifier(game: GameState) {
  return game.liveResolution.liveModifiers.find(
    (modifier) =>
      modifier.kind === 'CHEER_COUNT' &&
      modifier.abilityId ===
        SP_BP2_010_LIVE_START_OTHER_MEMBER_CHEER_COUNT_MINUS_EIGHT_ABILITY_ID
  );
}

describe('PL!SP-bp2-010 Margarete live-start cheer count workflow', () => {
  it('writes cheer-count -8 and auto cheer reveals max(0, total BLADE - 8) cards', () => {
    const { game } = setupGame({
      sourceBlade: 10,
      otherMember: createPlainMember('other-member'),
    });
    const state = resolveLiveStart(game);

    expect(cheerCountModifier(state)).toMatchObject({
      kind: 'CHEER_COUNT',
      playerId: PLAYER1,
      countDelta: -8,
    });

    const cheered = autoRevealCheer(state);
    expect(cheered.liveResolution.firstPlayerCheerCardIds).toHaveLength(2);
    expect(cheered.resolutionZone.revealedCardIds).toHaveLength(2);
  });

  it('reveals zero cards and does not perform automated cheer when final cheer count is zero', () => {
    const { game } = setupGame({
      sourceBlade: 8,
      otherMember: createPlainMember('other-member'),
    });
    const state = resolveLiveStart(game);

    const cheered = autoRevealCheer(state);

    expect(cheered).toBe(state);
    expect(cheered.liveResolution.firstPlayerCheerCardIds).toEqual([]);
    expect(cheered.actionHistory.some((action) => action.type === 'CHEER')).toBe(false);
    expect(
      cheered.eventLog.some((entry) => entry.event.eventType === TriggerCondition.ON_CHEER)
    ).toBe(false);
  });

  it('keeps BLADE total intact so 7 BLADE plus later BLADE +2 reveals one card', () => {
    const { game, source } = setupGame({
      sourceBlade: 7,
      otherMember: createPlainMember('other-member'),
    });
    const state = addLiveModifier(resolveLiveStart(game), {
      kind: 'BLADE',
      playerId: PLAYER1,
      countDelta: 2,
      sourceCardId: source.instanceId,
      abilityId: 'test-later-blade-plus-two',
    });

    const cheered = autoRevealCheer(state);

    expect(cheered.liveResolution.firstPlayerCheerCardIds).toHaveLength(1);
    expect(cheered.resolutionZone.revealedCardIds).toHaveLength(1);
  });

  it('counts another same-name Margarete instance as this-member-other member', () => {
    const sameNameOther = createPlainMember('same-name-other', 'ウィーン・マルガレーテ');
    const { game } = setupGame({ sourceBlade: 9, otherMember: sameNameOther });

    const state = resolveLiveStart(game);

    expect(cheerCountModifier(state)).toMatchObject({
      kind: 'CHEER_COUNT',
      countDelta: -8,
    });
  });

  it('consumes pending as no-op when there is no other stage member', () => {
    const { game } = setupGame({ sourceBlade: 9 });

    const state = resolveLiveStart(game);

    expect(state.pendingAbilities).toEqual([]);
    expect(state.activeEffect).toBeNull();
    expect(cheerCountModifier(state)).toBeUndefined();
    expect(
      [...state.actionHistory].reverse().find(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            SP_BP2_010_LIVE_START_OTHER_MEMBER_CHEER_COUNT_MINUS_EIGHT_ABILITY_ID
      )?.payload
    ).toMatchObject({
      conditionMet: false,
      cheerCountDelta: 0,
    });
  });

  it('does not keep the cheer-count modifier after live ends', () => {
    const { game } = setupGame({
      sourceBlade: 9,
      otherMember: createPlainMember('other-member'),
    });
    const state = resolveLiveStart(game);

    const finalized = new GameService().finalizeLiveResult({
      ...state,
      currentPhase: GamePhase.LIVE_RESULT_PHASE,
      currentSubPhase: SubPhase.RESULT_SETTLEMENT,
    });

    expect(finalized.success).toBe(true);
    expect(finalized.gameState.liveResolution.liveModifiers).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import type { LiveCardData, MemberCardData } from '../../src/domain/entities/card';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
} from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type GameState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import { addLiveModifier } from '../../src/domain/rules/live-modifiers';
import {
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { SP_PB2_004_LIVE_SUCCESS_SCORE_CONDITION_DRAW_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import {
  BladeHeartEffect,
  CardType,
  FaceState,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
} from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function createMember(cardCode: string): MemberCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames: ['Liella!'],
    cardType: CardType.MEMBER,
    cost: 2,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.RED, 1)],
  };
}

function createLive(cardCode: string, options: { readonly hasScore?: boolean } = {}): LiveCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames: ['Liella!'],
    cardType: CardType.LIVE,
    score: 3,
    requirements: createHeartRequirement({ [HeartColor.RED]: 1 }),
    bladeHearts: options.hasScore ? [{ effect: BladeHeartEffect.SCORE }] : [],
  };
}

function setupState(options: {
  readonly scoreCheerLive?: boolean;
  readonly liveZoneScoreBonus?: boolean;
} = {}): {
  readonly game: GameState;
  readonly sourceId: string;
  readonly liveZoneId: string;
  readonly cheerLiveId: string;
  readonly drawCardId: string;
} {
  const source = createCardInstance(
    createMember('PL!SP-pb2-004-R'),
    PLAYER1,
    'sp-pb2-004-source'
  );
  const liveZoneLive = createCardInstance(
    createLive('PL!SP-test-live-zone'),
    PLAYER1,
    'sp-pb2-004-live-zone'
  );
  const cheerLive = createCardInstance(
    createLive('PL!SP-test-cheer-live', { hasScore: options.scoreCheerLive === true }),
    PLAYER1,
    'sp-pb2-004-cheer-live'
  );
  const drawCard = createCardInstance(
    createMember('PL!SP-test-draw'),
    PLAYER1,
    'sp-pb2-004-draw'
  );

  let game = createGameState('sp-pb2-004-sumire', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [source, liveZoneLive, cheerLive, drawCard]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
    liveZone: {
      ...player.liveZone,
      cardIds: [liveZoneLive.instanceId],
      cardStates: new Map([
        [liveZoneLive.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
      ]),
    },
    mainDeck: {
      ...player.mainDeck,
      cardIds: [drawCard.instanceId],
    },
  }));
  game = {
    ...game,
    liveResolution: {
      ...game.liveResolution,
      isInLive: true,
      performingPlayerId: PLAYER1,
      playerScores: new Map([[PLAYER1, 3]]),
      firstPlayerCheerCardIds: [cheerLive.instanceId],
    },
    resolutionZone: {
      ...game.resolutionZone,
      cardIds: [cheerLive.instanceId],
      revealedCardIds: [cheerLive.instanceId],
    },
  };

  if (options.liveZoneScoreBonus === true) {
    game = addLiveModifier(game, {
      kind: 'SCORE',
      playerId: PLAYER1,
      countDelta: 1,
      liveCardId: liveZoneLive.instanceId,
      sourceCardId: liveZoneLive.instanceId,
      abilityId: 'test:score-bonus',
    });
  }

  return {
    game,
    sourceId: source.instanceId,
    liveZoneId: liveZoneLive.instanceId,
    cheerLiveId: cheerLive.instanceId,
    drawCardId: drawCard.instanceId,
  };
}

function startAbility(game: GameState, sourceCardId: string): GameState {
  const pendingAbility: PendingAbilityState = {
    id: 'sp-pb2-004-pending',
    abilityId: SP_PB2_004_LIVE_SUCCESS_SCORE_CONDITION_DRAW_ABILITY_ID,
    sourceCardId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId: TriggerCondition.ON_LIVE_SUCCESS,
    eventIds: ['live-success'],
    sourceSlot: SlotPosition.CENTER,
  };
  return confirmIfConfirmOnly(
    resolvePendingCardEffects({ ...game, pendingAbilities: [pendingAbility] }).gameState
  );
}

function confirmIfConfirmOnly(game: GameState): GameState {
  return game.activeEffect?.metadata?.confirmOnlyPendingAbility === true
    ? confirmActiveEffectStep(game, PLAYER1, game.activeEffect.id)
    : game;
}

function latestPayload(game: GameState) {
  return game.actionHistory
    .filter(
      (action) =>
        action.type === 'RESOLVE_ABILITY' &&
        action.payload.abilityId === SP_PB2_004_LIVE_SUCCESS_SCORE_CONDITION_DRAW_ABILITY_ID
    )
    .at(-1)?.payload;
}

describe('PL!SP-pb2-004 Sumire live success draw workflow', () => {
  it('draws one when own revealed cheer includes a SCORE live card', () => {
    const scenario = setupState({ scoreCheerLive: true });
    const state = startAbility(scenario.game, scenario.sourceId);

    expect(state.players[0].hand.cardIds).toContain(scenario.drawCardId);
    expect(latestPayload(state)).toMatchObject({
      conditionMet: true,
      scoreCheerLiveCardIds: [scenario.cheerLiveId],
      drawnCardIds: [scenario.drawCardId],
    });
  });

  it('draws one when own live zone has a live card above its original score', () => {
    const scenario = setupState({ liveZoneScoreBonus: true });
    const state = startAbility(scenario.game, scenario.sourceId);

    expect(state.players[0].hand.cardIds).toContain(scenario.drawCardId);
    expect(latestPayload(state)).toMatchObject({
      conditionMet: true,
      higherScoreLiveCardIds: [scenario.liveZoneId],
      drawnCardIds: [scenario.drawCardId],
    });
  });

  it('consumes pending no-op when neither condition is met', () => {
    const scenario = setupState();
    const state = startAbility(scenario.game, scenario.sourceId);

    expect(state.players[0].hand.cardIds).not.toContain(scenario.drawCardId);
    expect(latestPayload(state)).toMatchObject({
      conditionMet: false,
      higherScoreLiveCardIds: [],
      scoreCheerLiveCardIds: [],
      drawnCardIds: [],
    });
  });
});

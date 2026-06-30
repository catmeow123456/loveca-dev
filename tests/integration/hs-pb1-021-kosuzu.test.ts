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
} from '../../src/domain/entities/game';
import { addCardToStatefulZone, placeCardInSlot } from '../../src/domain/entities/zone';
import { createConfirmEffectStepCommand } from '../../src/application/game-commands';
import { GameService } from '../../src/application/game-service';
import { createGameSession } from '../../src/application/game-session';
import { HS_PB1_021_LIVE_SUCCESS_DOLLCHESTRA_LIVE_ZONE_DRAW_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import {
  CardType,
  FaceState,
  GamePhase,
  HeartColor,
  OrientationState,
  SlotPosition,
  SubPhase,
  TriggerCondition,
} from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';
const ABILITY_ORDER_SELECTION_ID = 'system:select-pending-card-effect';

function createKosuzu(): MemberCardData {
  return {
    cardCode: 'PL!HS-pb1-021-N',
    name: '徒町小鈴',
    groupNames: ['蓮ノ空女学院スクールアイドルクラブ'],
    unitName: 'DOLLCHESTRA',
    cardType: CardType.MEMBER,
    cost: 5,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.BLUE, 2)],
  };
}

function createDrawCard(cardCode: string): MemberCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames: ['蓮ノ空女学院スクールアイドルクラブ'],
    cardType: CardType.MEMBER,
    cost: 1,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.BLUE, 1)],
  };
}

function createLive(cardCode: string, unitName: string): LiveCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames: ['蓮ノ空女学院スクールアイドルクラブ'],
    unitName,
    cardType: CardType.LIVE,
    score: 3,
    requirements: createHeartRequirement({ [HeartColor.BLUE]: 1 }),
  };
}

function setupKosuzuLiveSuccess(options: {
  readonly hasDollchestraLive: boolean;
  readonly sourceCount?: 1 | 2;
}): {
  readonly state: GameState;
  readonly sourceIds: readonly string[];
  readonly liveId: string;
  readonly drawCardId: string;
} {
  const sourceCount = options.sourceCount ?? 1;
  const sources = Array.from({ length: sourceCount }, (_, index) =>
    createCardInstance(createKosuzu(), PLAYER1, `kosuzu-${index}`)
  );
  const live = createCardInstance(
    createLive(
      options.hasDollchestraLive ? 'PL!HS-test-dollchestra-live' : 'PL!HS-test-cerise-live',
      options.hasDollchestraLive ? 'DOLLCHESTRA' : 'Cerise Bouquet'
    ),
    PLAYER1,
    'live-card'
  );
  const drawCard = createCardInstance(createDrawCard('PL!HS-test-draw'), PLAYER1, 'draw-card');

  let game = createGameState('hs-pb1-021-kosuzu', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [...sources, live, drawCard]);
  game = updatePlayer(game, PLAYER1, (player) => {
    const staged = sources.reduce(
      (slots, source, index) =>
        placeCardInSlot(
          slots,
          index === 0 ? SlotPosition.LEFT : SlotPosition.CENTER,
          source.instanceId,
          { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }
        ),
      player.memberSlots
    );

    return {
      ...player,
      hand: { ...player.hand, cardIds: [] },
      mainDeck: { ...player.mainDeck, cardIds: [drawCard.instanceId] },
      liveZone: addCardToStatefulZone(player.liveZone, live.instanceId),
      memberSlots: staged,
    };
  });
  game = {
    ...game,
    currentPhase: GamePhase.LIVE_RESULT_PHASE,
    currentSubPhase: SubPhase.RESULT_FIRST_SUCCESS_EFFECTS,
    firstPlayerIndex: 0,
    activePlayerIndex: 0,
    liveResolution: {
      ...game.liveResolution,
      liveResults: new Map([[live.instanceId, true]]),
      playerScores: new Map([[PLAYER1, 3]]),
      performingPlayerId: PLAYER1,
    },
  };

  const result = new GameService().executeCheckTiming(game, [TriggerCondition.ON_LIVE_SUCCESS]);
  expect(result.success).toBe(true);
  const state =
    sourceCount === 1 && result.gameState.activeEffect?.metadata?.confirmOnlyPendingAbility === true
      ? confirmActiveEffect(result.gameState)
      : result.gameState;
  return {
    state,
    sourceIds: sources.map((source) => source.instanceId),
    liveId: live.instanceId,
    drawCardId: drawCard.instanceId,
  };
}

function confirmActiveEffect(state: GameState, selectedCardId?: string): GameState {
  const session = createGameSession();
  session.createGame('hs-pb1-021-kosuzu-session', PLAYER1, 'P1', PLAYER2, 'P2');
  (session as unknown as { authorityState: GameState }).authorityState = state;
  const result = session.executeCommand(
    createConfirmEffectStepCommand(PLAYER1, state.activeEffect!.id, selectedCardId)
  );
  expect(result.success).toBe(true);
  return session.state!;
}

describe('PL!HS-pb1-021-N Kosuzu live success workflow', () => {
  it('draws one card when the own live zone has a DOLLCHESTRA card', () => {
    const { state, sourceIds, liveId, drawCardId } = setupKosuzuLiveSuccess({
      hasDollchestraLive: true,
    });

    expect(state.pendingAbilities).toEqual([]);
    expect(state.players[0].hand.cardIds).toEqual([drawCardId]);
    expect(
      state.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            HS_PB1_021_LIVE_SUCCESS_DOLLCHESTRA_LIVE_ZONE_DRAW_ABILITY_ID &&
          action.payload.sourceCardId === sourceIds[0] &&
          action.payload.conditionMet === true &&
          Array.isArray(action.payload.dollchestraLiveZoneCardIds) &&
          action.payload.dollchestraLiveZoneCardIds.includes(liveId) &&
          Array.isArray(action.payload.drawnCardIds) &&
          action.payload.drawnCardIds.includes(drawCardId)
      )
    ).toBe(true);
  });

  it('does not draw when the own live zone has no DOLLCHESTRA card', () => {
    const { state, drawCardId } = setupKosuzuLiveSuccess({ hasDollchestraLive: false });

    expect(state.pendingAbilities).toEqual([]);
    expect(state.players[0].hand.cardIds).toEqual([]);
    expect(state.players[0].mainDeck.cardIds).toEqual([drawCardId]);
    expect(
      state.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            HS_PB1_021_LIVE_SUCCESS_DOLLCHESTRA_LIVE_ZONE_DRAW_ABILITY_ID &&
          action.payload.conditionMet === false &&
          Array.isArray(action.payload.drawnCardIds) &&
          action.payload.drawnCardIds.length === 0
      )
    ).toBe(true);
  });

  it('shows a condition summary before drawing when manually chosen from a live-success queue', () => {
    const { state, sourceIds, drawCardId } = setupKosuzuLiveSuccess({
      hasDollchestraLive: true,
      sourceCount: 2,
    });

    expect(state.activeEffect?.abilityId).toBe(ABILITY_ORDER_SELECTION_ID);
    expect(state.activeEffect?.selectableCardIds).toEqual(sourceIds);

    const confirmOnlyState = confirmActiveEffect(state, sourceIds[0]);

    expect(confirmOnlyState.activeEffect).toMatchObject({
      abilityId: HS_PB1_021_LIVE_SUCCESS_DOLLCHESTRA_LIVE_ZONE_DRAW_ABILITY_ID,
      sourceCardId: sourceIds[0],
      stepId: 'CONFIRM_ONLY_EFFECT',
      stepText: '自己的LIVE卡区存在『DOLLCHESTRA』卡片，条件满足。确认后抽 1 张卡。',
    });

    let resolvedState = confirmActiveEffect(confirmOnlyState);
    if (resolvedState.activeEffect?.metadata?.confirmOnlyPendingAbility === true) {
      resolvedState = confirmActiveEffect(resolvedState);
    }

    expect(resolvedState.players[0].hand.cardIds).toEqual([drawCardId]);
    expect(
      resolvedState.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            HS_PB1_021_LIVE_SUCCESS_DOLLCHESTRA_LIVE_ZONE_DRAW_ABILITY_ID &&
          action.payload.sourceCardId === sourceIds[0] &&
          action.payload.conditionMet === true &&
          Array.isArray(action.payload.drawnCardIds) &&
          action.payload.drawnCardIds.includes(drawCardId)
      )
    ).toBe(true);
  });
});

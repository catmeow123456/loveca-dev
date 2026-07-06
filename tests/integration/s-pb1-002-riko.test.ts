import { describe, expect, it } from 'vitest';
import type { AnyCardData, LiveCardData, MemberCardData } from '../../src/domain/entities/card';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
  type CardInstance,
} from '../../src/domain/entities/card';
import {
  createGameState,
  emitGameEvent,
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import { addCardToZone, placeCardInSlot, removeCardFromSlot } from '../../src/domain/entities/zone';
import { getPlayerLiveScoreModifier } from '../../src/domain/rules/live-modifiers';
import { createEnterStageEvent } from '../../src/domain/events/game-events';
import { createConfirmEffectStepCommand } from '../../src/application/game-commands';
import { createGameSession, type GameSession } from '../../src/application/game-session';
import {
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  HS_PB1_003_AUTO_HAND_TO_WAITING_GAIN_HEART_BLADE_ABILITY_ID,
  PL_S_PB1_002_ON_ENTER_OPPONENT_DISCARD_LIVE_OR_SOURCE_SCORE_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import {
  CardType,
  FaceState,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
  ZoneType,
} from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function member(cardCode: string, name = cardCode): MemberCardData {
  return {
    cardCode,
    name,
    groupNames: ['Aqours'],
    cardType: CardType.MEMBER,
    cost: 13,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.RED, 1)],
  };
}

function live(cardCode: string): LiveCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames: ['Aqours'],
    cardType: CardType.LIVE,
    score: 3,
    requirements: createHeartRequirement({ [HeartColor.RED]: 1 }),
  };
}

function instance<TData extends AnyCardData>(
  data: TData,
  id: string,
  ownerId = PLAYER1
): CardInstance<TData> {
  return createCardInstance(data, ownerId, id);
}

function sessionWithState(game: GameState): GameSession {
  const session = createGameSession();
  session.createGame('s-pb1-002-riko', PLAYER1, 'P1', PLAYER2, 'P2');
  (session as unknown as { authorityState: GameState }).authorityState = game;
  return session;
}

function setup(options: {
  readonly opponentHandCards?: readonly CardInstance<AnyCardData>[];
  readonly includeOpponentHandTriggerSource?: boolean;
} = {}) {
  const source = instance(member('PL!S-pb1-002-R', '桜内梨子'), 'riko-source');
  const opponentHandCards =
    options.opponentHandCards ?? [instance(live('opponent-live'), 'opponent-live', PLAYER2)];
  const triggerSource = instance(
    {
      ...member('PL!HS-pb1-003-R', '大沢瑠璃乃'),
      groupNames: ['蓮ノ空'],
    },
    'opponent-trigger-source',
    PLAYER2
  );
  const cards = [
    source,
    ...opponentHandCards,
    ...(options.includeOpponentHandTriggerSource ? [triggerSource] : []),
  ];

  let game = registerCards(createGameState('s-pb1-002-riko', PLAYER1, 'P1', PLAYER2, 'P2'), cards);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
  }));
  game = updatePlayer(game, PLAYER2, (player) => ({
    ...player,
    hand: opponentHandCards.reduce((zone, card) => addCardToZone(zone, card.instanceId), player.hand),
    memberSlots: options.includeOpponentHandTriggerSource
      ? placeCardInSlot(player.memberSlots, SlotPosition.CENTER, triggerSource.instanceId, {
          orientation: OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        })
      : player.memberSlots,
  }));

  return { game, source, opponentHandCards, triggerSource };
}

function startOnEnter(game: GameState, sourceId: string): GameState {
  const enterStageEvent = createEnterStageEvent(
    sourceId,
    ZoneType.HAND,
    SlotPosition.CENTER,
    PLAYER1,
    PLAYER1
  );
  return resolvePendingCardEffects(
    enqueueTriggeredCardEffects(emitGameEvent(game, enterStageEvent), [
      TriggerCondition.ON_ENTER_STAGE,
    ], {
      enterStageEvents: [enterStageEvent],
    })
  ).gameState;
}

describe('PL!S-pb1-002 桜内梨子', () => {
  it('lets the opponent discard a hand LIVE to their waiting room through hand-to-waiting triggers', () => {
    const { game, source, opponentHandCards } = setup({ includeOpponentHandTriggerSource: true });
    const liveId = opponentHandCards[0]!.instanceId;
    const started = startOnEnter(game, source.instanceId);

    expect(started.activeEffect).toMatchObject({
      abilityId: PL_S_PB1_002_ON_ENTER_OPPONENT_DISCARD_LIVE_OR_SOURCE_SCORE_ABILITY_ID,
      awaitingPlayerId: PLAYER2,
      selectableCardIds: [liveId],
    });

    const session = sessionWithState(started);
    const result = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER2, started.activeEffect!.id, liveId)
    );

    expect(result.success, result.error).toBe(true);
    expect(result.gameState.players[1]!.hand.cardIds).not.toContain(liveId);
    expect(result.gameState.players[1]!.waitingRoom.cardIds).toContain(liveId);
    expect(
      result.gameState.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId === HS_PB1_003_AUTO_HAND_TO_WAITING_GAIN_HEART_BLADE_ABILITY_ID
      )
    ).toBe(true);
  });

  it('adds SCORE +1 when the opponent declines', () => {
    const { game, source } = setup();
    const started = startOnEnter(game, source.instanceId);
    const declined = sessionWithState(started).executeCommand(
      createConfirmEffectStepCommand(PLAYER2, started.activeEffect!.id, null)
    );
    expect(declined.success, declined.error).toBe(true);
    expect(getPlayerLiveScoreModifier(declined.gameState.liveResolution, PLAYER1)).toBe(1);
  });

  it('still asks the opponent to decline when they have no LIVE, without revealing that hand fact', () => {
    const noLive = setup({
      opponentHandCards: [instance(member('opponent-member'), 'opponent-member', PLAYER2)],
    });
    const started = startOnEnter(noLive.game, noLive.source.instanceId);
    expect(started.activeEffect).toMatchObject({
      abilityId: PL_S_PB1_002_ON_ENTER_OPPONENT_DISCARD_LIVE_OR_SOURCE_SCORE_ABILITY_ID,
      awaitingPlayerId: PLAYER2,
      selectableCardIds: [],
      canSkipSelection: true,
      skipSelectionLabel: '不放置',
    });
    expect(getPlayerLiveScoreModifier(started.liveResolution, PLAYER1)).toBe(0);

    const declined = sessionWithState(started).executeCommand(
      createConfirmEffectStepCommand(PLAYER2, started.activeEffect!.id, null)
    );
    expect(declined.success, declined.error).toBe(true);
    expect(getPlayerLiveScoreModifier(declined.gameState.liveResolution, PLAYER1)).toBe(1);
  });

  it('rejects non-LIVE, non-opponent-hand, and stale LIVE selections without moving cards', () => {
    const ownLive = instance(live('own-live'), 'own-live', PLAYER1);
    const opponentLiveCard = instance(live('opponent-live'), 'opponent-live', PLAYER2);
    const opponentMember = instance(member('opponent-member'), 'opponent-member', PLAYER2);
    const { game, source } = setup({
      opponentHandCards: [opponentLiveCard, opponentMember],
    });
    const withOwnLive = registerCards(game, [ownLive]);
    const started = startOnEnter(withOwnLive, source.instanceId);

    const invalidMember = sessionWithState(started).executeCommand(
      createConfirmEffectStepCommand(PLAYER2, started.activeEffect!.id, opponentMember.instanceId)
    );
    expect(invalidMember.success).toBe(false);
    expect(invalidMember.error).toBe('选择的卡牌不能用于当前效果');

    const invalidOwnLive = sessionWithState(started).executeCommand(
      createConfirmEffectStepCommand(PLAYER2, started.activeEffect!.id, ownLive.instanceId)
    );
    expect(invalidOwnLive.success).toBe(false);
    expect(invalidOwnLive.error).toBe('选择的卡牌不能用于当前效果');

    const staleState = updatePlayer(started, PLAYER2, (player) => ({
      ...player,
      hand: { ...player.hand, cardIds: player.hand.cardIds.filter((id) => id !== opponentLiveCard.instanceId) },
      waitingRoom: addCardToZone(player.waitingRoom, opponentLiveCard.instanceId),
    }));
    const staleSession = sessionWithState(staleState);
    const stale = staleSession.executeCommand(
      createConfirmEffectStepCommand(PLAYER2, staleState.activeEffect!.id, opponentLiveCard.instanceId)
    );
    expect(stale.success).toBe(false);
    expect(stale.error).toBe('卡牌效果步骤确认失败');
    expect(staleSession.state!.players[1]!.hand.cardIds).not.toContain(opponentLiveCard.instanceId);
    expect(staleSession.state!.players[1]!.waitingRoom.cardIds).toContain(opponentLiveCard.instanceId);
    expect(staleSession.state!.activeEffect).not.toBeNull();
  });

  it('is a safe no-op when the source has left the stage before SCORE is granted', () => {
    const { game, source } = setup({ opponentHandCards: [] });
    const sourceLeft = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.CENTER),
    }));
    const resolved = startOnEnter(sourceLeft, source.instanceId);

    expect(resolved.activeEffect).toBeNull();
    expect(getPlayerLiveScoreModifier(resolved.liveResolution, PLAYER1)).toBe(0);
  });
});

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
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import { addCardToZone, placeCardInSlot, removeCardFromSlot } from '../../src/domain/entities/zone';
import { getMemberEffectiveBladeCount } from '../../src/domain/rules/live-modifiers';
import {
  createActivateAbilityCommand,
  createConfirmEffectStepCommand,
} from '../../src/application/game-commands';
import { createGameSession, type GameSession } from '../../src/application/game-session';
import { canUseActivatedAbilityThisTurn } from '../../src/application/card-effect-runner';
import {
  HS_PB1_003_AUTO_HAND_TO_WAITING_GAIN_HEART_BLADE_ABILITY_ID,
  PL_S_PB1_006_ACTIVATED_REVEAL_HAND_LIVE_OPPONENT_DISCARD_OR_GAIN_FOUR_BLADE_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
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
const ABILITY_ID =
  PL_S_PB1_006_ACTIVATED_REVEAL_HAND_LIVE_OPPONENT_DISCARD_OR_GAIN_FOUR_BLADE_ABILITY_ID;

function member(cardCode: string, name = cardCode, cost = 9): MemberCardData {
  return {
    cardCode,
    name,
    groupNames: ['Aqours'],
    cardType: CardType.MEMBER,
    cost,
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
  session.createGame('s-pb1-006-yoshiko', PLAYER1, 'P1', PLAYER2, 'P2');
  (session as unknown as { authorityState: GameState }).authorityState = game;
  return session;
}

function setup(options: {
  readonly ownHandCards?: readonly CardInstance<AnyCardData>[];
  readonly opponentHandCards?: readonly CardInstance<AnyCardData>[];
  readonly sourceOnStage?: boolean;
  readonly currentPhase?: GamePhase;
  readonly activePlayerIndex?: number;
  readonly includeOpponentHandTriggerSource?: boolean;
} = {}) {
  const source = instance(member('PL!S-pb1-006-R', '津島善子', 9), 'yoshiko-source');
  const ownHandCards =
    options.ownHandCards ?? [instance(live('own-live'), 'own-live', PLAYER1)];
  const opponentHandCards =
    options.opponentHandCards ??
    [instance(member('opponent-member', 'opponent-member', 5), 'opponent-member', PLAYER2)];
  const triggerSource = instance(
    {
      ...member('PL!HS-pb1-003-R', '大沢瑠璃乃', 9),
      groupNames: ['蓮ノ空'],
    },
    'opponent-trigger-source',
    PLAYER2
  );
  const cards = [
    source,
    ...ownHandCards,
    ...opponentHandCards,
    ...(options.includeOpponentHandTriggerSource ? [triggerSource] : []),
  ];

  let game = registerCards(
    createGameState('s-pb1-006-yoshiko', PLAYER1, 'P1', PLAYER2, 'P2'),
    cards
  );
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    hand: ownHandCards.reduce((zone, card) => addCardToZone(zone, card.instanceId), player.hand),
    memberSlots:
      options.sourceOnStage === false
        ? player.memberSlots
        : placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
            orientation: OrientationState.ACTIVE,
            face: FaceState.FACE_UP,
          }),
  }));
  game = updatePlayer(game, PLAYER2, (player) => ({
    ...player,
    hand: opponentHandCards.reduce(
      (zone, card) => addCardToZone(zone, card.instanceId),
      player.hand
    ),
    memberSlots: options.includeOpponentHandTriggerSource
      ? placeCardInSlot(player.memberSlots, SlotPosition.CENTER, triggerSource.instanceId, {
          orientation: OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        })
      : player.memberSlots,
  }));

  const mutableGame = game as unknown as {
    currentPhase: GamePhase;
    currentSubPhase: SubPhase;
    activePlayerIndex: number;
    waitingPlayerId: string | null;
  };
  mutableGame.currentPhase = options.currentPhase ?? GamePhase.MAIN_PHASE;
  mutableGame.currentSubPhase = SubPhase.NONE;
  mutableGame.activePlayerIndex = options.activePlayerIndex ?? 0;
  mutableGame.waitingPlayerId = null;

  return { game, source, ownHandCards, opponentHandCards, triggerSource };
}

function activate(session: GameSession, sourceId: string) {
  return session.executeCommand(createActivateAbilityCommand(PLAYER1, sourceId, ABILITY_ID));
}

function confirm(session: GameSession, playerId: string, selectedCardId?: string | null) {
  return session.executeCommand(
    createConfirmEffectStepCommand(playerId, session.state!.activeEffect!.id, selectedCardId)
  );
}

describe('PL!S-pb1-006 津島善子 activated reveal LIVE', () => {
  it('starts in own main phase, reveals one hand LIVE, and exposes revealedObjectIds to both players', () => {
    const { game, source, ownHandCards, opponentHandCards } = setup();
    const session = sessionWithState(game);

    const start = activate(session, source.instanceId);
    expect(start.success, start.error).toBe(true);
    expect(session.state?.activeEffect).toMatchObject({
      abilityId: ABILITY_ID,
      awaitingPlayerId: PLAYER1,
      selectableCardIds: [ownHandCards[0]!.instanceId],
    });

    const reveal = confirm(session, PLAYER1, ownHandCards[0]!.instanceId);
    expect(reveal.success, reveal.error).toBe(true);
    expect(session.state?.activeEffect).toMatchObject({
      abilityId: ABILITY_ID,
      awaitingPlayerId: PLAYER2,
      selectableCardIds: [opponentHandCards[0]!.instanceId],
      revealedCardIds: [ownHandCards[0]!.instanceId],
    });
    expect(session.getPlayerViewState(PLAYER1).activeEffect?.revealedObjectIds).toEqual([
      `obj_${ownHandCards[0]!.instanceId}`,
    ]);
    expect(session.getPlayerViewState(PLAYER2).activeEffect?.revealedObjectIds).toEqual([
      `obj_${ownHandCards[0]!.instanceId}`,
    ]);
  });

  it('lets the opponent discard any one hand card through hand-to-waiting triggers without granting BLADE', () => {
    const { game, source, ownHandCards, opponentHandCards } = setup({
      includeOpponentHandTriggerSource: true,
    });
    const session = sessionWithState(game);

    expect(activate(session, source.instanceId).success).toBe(true);
    expect(confirm(session, PLAYER1, ownHandCards[0]!.instanceId).success).toBe(true);
    const discard = confirm(session, PLAYER2, opponentHandCards[0]!.instanceId);

    expect(discard.success, discard.error).toBe(true);
    expect(session.state?.players[1]!.hand.cardIds).not.toContain(opponentHandCards[0]!.instanceId);
    expect(session.state?.players[1]!.waitingRoom.cardIds).toContain(
      opponentHandCards[0]!.instanceId
    );
    expect(
      session.state?.eventLog.some(
        (entry) =>
          entry.event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM &&
          entry.event.cardInstanceId === opponentHandCards[0]!.instanceId
      )
    ).toBe(true);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId === HS_PB1_003_AUTO_HAND_TO_WAITING_GAIN_HEART_BLADE_ABILITY_ID
      )
    ).toBe(true);
    expect(getMemberEffectiveBladeCount(session.state!, PLAYER1, source.instanceId)).toBe(1);
  });

  it('grants BLADE +4 when the opponent declines or has no hand after the reveal cost succeeds', () => {
    const declined = setup();
    const declinedSession = sessionWithState(declined.game);
    expect(activate(declinedSession, declined.source.instanceId).success).toBe(true);
    expect(confirm(declinedSession, PLAYER1, declined.ownHandCards[0]!.instanceId).success).toBe(
      true
    );
    expect(confirm(declinedSession, PLAYER2, null).success).toBe(true);
    expect(
      getMemberEffectiveBladeCount(declinedSession.state!, PLAYER1, declined.source.instanceId)
    ).toBe(5);

    const noHand = setup({ opponentHandCards: [] });
    const noHandSession = sessionWithState(noHand.game);
    expect(activate(noHandSession, noHand.source.instanceId).success).toBe(true);
    const reveal = confirm(noHandSession, PLAYER1, noHand.ownHandCards[0]!.instanceId);
    expect(reveal.success, reveal.error).toBe(true);
    expect(noHandSession.state?.activeEffect).toBeNull();
    expect(
      getMemberEffectiveBladeCount(noHandSession.state!, PLAYER1, noHand.source.instanceId)
    ).toBe(5);
  });

  it('does not start without a hand LIVE, outside own main phase, or when the source is off stage', () => {
    for (const { game, source } of [
      setup({ ownHandCards: [instance(member('own-member'), 'own-member', 4)] }),
      setup({ currentPhase: GamePhase.LIVE_SET_PHASE }),
      setup({ activePlayerIndex: 1 }),
      setup({ sourceOnStage: false }),
    ]) {
      const session = sessionWithState(game);
      activate(session, source.instanceId);
      expect(session.state?.activeEffect).toBeNull();
      expect(
        session.state?.actionHistory.some(
          (action) =>
            action.payload.abilityId === ABILITY_ID &&
            action.payload.step === 'START_REVEAL_HAND_LIVE'
        )
      ).toBe(false);
    }
  });

  it('rejects non-LIVE reveal choices and stale hand selections without recording turn use', () => {
    const ownLive = instance(live('own-live'), 'own-live', PLAYER1);
    const ownMember = instance(member('own-member'), 'own-member', 4);
    const { game, source } = setup({ ownHandCards: [ownLive, ownMember] });
    const session = sessionWithState(game);

    expect(activate(session, source.instanceId).success).toBe(true);
    const invalidMember = confirm(session, PLAYER1, ownMember.instanceId);
    expect(invalidMember.success).toBe(false);
    expect(invalidMember.error).toBe('选择的卡牌不能用于当前效果');

    const staleState = updatePlayer(session.state!, PLAYER1, (player) => ({
      ...player,
      hand: {
        ...player.hand,
        cardIds: player.hand.cardIds.filter((id) => id !== ownLive.instanceId),
      },
      waitingRoom: addCardToZone(player.waitingRoom, ownLive.instanceId),
    }));
    const staleSession = sessionWithState(staleState);
    const stale = confirm(staleSession, PLAYER1, ownLive.instanceId);
    expect(stale.success).toBe(false);
    expect(stale.error).toBe('卡牌效果步骤确认失败');
    expect(
      staleSession.state?.actionHistory.some(
        (action) =>
          action.payload.abilityId === ABILITY_ID && action.payload.step === 'ABILITY_USE'
      )
    ).toBe(false);
  });

  it('records turn use after a successful reveal and prevents the same source from activating again this turn', () => {
    const { game, source, ownHandCards } = setup();
    const session = sessionWithState(game);

    expect(activate(session, source.instanceId).success).toBe(true);
    expect(
      session.state &&
        canUseActivatedAbilityThisTurn(session.state, PLAYER1, ABILITY_ID, source.instanceId)
    ).toBe(true);
    expect(confirm(session, PLAYER1, ownHandCards[0]!.instanceId).success).toBe(true);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.payload.abilityId === ABILITY_ID && action.payload.step === 'ABILITY_USE'
      )
    ).toBe(true);
    expect(canUseActivatedAbilityThisTurn(session.state!, PLAYER1, ABILITY_ID, source.instanceId)).toBe(
      false
    );
  });

  it('clears the effect and grants no BLADE if the source leaves before the opponent choice', () => {
    const { game, source, ownHandCards } = setup();
    const session = sessionWithState(game);

    expect(activate(session, source.instanceId).success).toBe(true);
    expect(confirm(session, PLAYER1, ownHandCards[0]!.instanceId).success).toBe(true);

    const sourceLeft = updatePlayer(session.state!, PLAYER1, (player) => ({
      ...player,
      memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.CENTER),
    }));
    const movedSession = sessionWithState(sourceLeft);
    const declined = confirm(movedSession, PLAYER2, null);

    expect(declined.success, declined.error).toBe(true);
    expect(movedSession.state?.activeEffect).toBeNull();
    expect(getMemberEffectiveBladeCount(movedSession.state!, PLAYER1, source.instanceId)).toBe(1);
  });
});

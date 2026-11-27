import { describe, expect, it } from 'vitest';
import { S_PB2_036_LIVE_SUCCESS_DRAW_ONE_PLACE_HAND_BOTTOM_ABILITY_ID as ABILITY } from '../../src/application/card-effects/ability-ids';
import { getCardAbilityDefinitionsForCardCode } from '../../src/application/card-effects/definitions/lookup';
import {
  createConfirmEffectStepCommand,
  createConfirmStepCommand,
} from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import {
  createCardInstance,
  createHeartRequirement,
  type LiveCardData,
  type MemberCardData,
} from '../../src/domain/entities/card';
import { createGameState, registerCards, updatePlayer } from '../../src/domain/entities/game';
import { addCardToStatefulZone, placeCardInSlot } from '../../src/domain/entities/zone';
import { createPublicObjectId } from '../../src/online/projector';
import {
  CardType,
  FaceState,
  GamePhase,
  HeartColor,
  OrientationState,
  SlotPosition,
  SubPhase,
  TriggerCondition,
  TurnType,
} from '../../src/shared/types/enums';
import { getNovember20MemberData } from '../helpers/november-20-draft-effects';

const P1 = 'p1';
const P2 = 'p2';
const BASE_CODE = 'PL!S-pb2-036';
const TEXT = '【LIVE成功时】抽１张卡，将１张手牌放置于牌库底。';

function member(id: string) {
  const data: MemberCardData = {
    cardType: CardType.MEMBER,
    cardCode: `TEST-${id}`,
    name: id,
    cost: 4,
    blade: 1,
    hearts: [],
  };
  return createCardInstance(data, P1, id);
}

function liveCard(id: string, owner: string) {
  const data: LiveCardData = {
    cardType: CardType.LIVE,
    cardCode: `TEST-${id}`,
    name: id,
    score: 2,
    requirements: createHeartRequirement({ [HeartColor.BLUE]: 1 }),
  };
  return createCardInstance(data, owner, id);
}

function setup(
  options: {
    readonly hand?: readonly string[];
    readonly deck?: readonly string[];
    readonly waitingRoom?: readonly string[];
    readonly ownSuccess?: boolean;
  } = {}
) {
  const ownSuccess = options.ownSuccess ?? true;
  const source = createCardInstance(getNovember20MemberData(BASE_CODE), P1, 'source');
  const ownLive = liveCard('own-live', P1);
  const opponentLive = liveCard('opponent-live', P2);
  const hand = options.hand ?? ['hand'];
  const deck = options.deck ?? ['drawn', 'remaining-top', 'remaining-bottom'];
  const waitingRoom = options.waitingRoom ?? [];
  let game = registerCards(createGameState('s-pb2-036', P1, 'P1', P2, 'P2'), [
    source,
    ownLive,
    opponentLive,
    ...[...hand, ...deck, ...waitingRoom].map(member),
  ]);
  game = updatePlayer(game, P1, (player) => ({
    ...player,
    memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.LEFT, source.instanceId, {
      orientation: OrientationState.WAITING,
      face: FaceState.FACE_UP,
    }),
    hand: { ...player.hand, cardIds: hand },
    mainDeck: { ...player.mainDeck, cardIds: deck },
    waitingRoom: { ...player.waitingRoom, cardIds: waitingRoom },
    liveZone: addCardToStatefulZone(player.liveZone, ownLive.instanceId),
  }));
  game = updatePlayer(game, P2, (player) => ({
    ...player,
    liveZone: addCardToStatefulZone(player.liveZone, opponentLive.instanceId),
  }));
  game = {
    ...game,
    currentPhase: GamePhase.PERFORMANCE_PHASE,
    currentSubPhase: SubPhase.PERFORMANCE_JUDGMENT,
    currentTurnType: TurnType.SECOND_PLAYER_TURN,
    firstPlayerIndex: 0,
    activePlayerIndex: 1,
    liveResolution: {
      ...game.liveResolution,
      performingPlayerId: P2,
      liveResults: new Map([
        [ownLive.instanceId, ownSuccess],
        [opponentLive.instanceId, !ownSuccess],
      ]),
      playerScores: new Map([
        [P1, ownSuccess ? 2 : 0],
        [P2, ownSuccess ? 0 : 2],
      ]),
    },
  };

  const session = createGameSession();
  session.restoreRuntimeState({ authorityState: game, currentPublicSeq: 0 });

  return {
    session,
    enter: () =>
      session.executeCommand(createConfirmStepCommand(P2, SubPhase.PERFORMANCE_JUDGMENT)),
    confirm: (cardId?: string | null, playerId = P1) =>
      session.executeCommand(
        createConfirmEffectStepCommand(playerId, session.state!.activeEffect!.id, cardId)
      ),
  };
}

describe('PL!S-pb2-036 费用2「黑泽露比」', () => {
  it('registers the exact exported paragraph at LIVE_SUCCESS for all rarities', () => {
    for (const rarity of ['N', 'UNSEEN']) {
      expect(getCardAbilityDefinitionsForCardCode(`${BASE_CODE}-${rarity}`)).toEqual([
        expect.objectContaining({
          abilityId: ABILITY,
          baseCardCodes: [BASE_CODE],
          category: 'LIVE_SUCCESS',
          sourceZone: 'STAGE_MEMBER',
          triggerCondition: TriggerCondition.ON_LIVE_SUCCESS,
          implemented: true,
          queued: true,
          effectText: TEXT,
        }),
      ]);
    }
  });

  it('draws on the real success event and requires a private placement at the very bottom', () => {
    const { session, enter, confirm } = setup();
    expect(session.state!.players[0].hand.cardIds).toEqual(['hand']);
    const entered = enter();
    expect(entered.success, entered.error).toBe(true);
    expect(session.state!.eventLog.map(({ event }) => event)).toContainEqual(
      expect.objectContaining({
        eventType: TriggerCondition.ON_LIVE_SUCCESS,
        playerId: P1,
        successfulLiveCardIds: ['own-live'],
      })
    );
    expect(session.state!.activeEffect).toMatchObject({
      abilityId: ABILITY,
      effectText: TEXT,
      sourceCardId: 'source',
      selectableCardIds: ['hand', 'drawn'],
      selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
      confirmSelectionLabel: '放置于卡组底',
      canSkipSelection: false,
    });
    const effectId = session.state!.activeEffect!.id;
    expect(session.state!.players[0].hand.cardIds).toEqual(['hand', 'drawn']);
    expect(session.state!.players[0].mainDeck.cardIds).toEqual([
      'remaining-top',
      'remaining-bottom',
    ]);
    expect(session.getPlayerViewState(P1)!.activeEffect?.selectableObjectIds).toEqual(
      ['hand', 'drawn'].map(createPublicObjectId)
    );
    const opponent = session.getPlayerViewState(P2)!;
    expect(opponent.activeEffect?.selectableObjectIds).toBeUndefined();
    for (const id of ['hand', 'drawn']) {
      expect(opponent.objects[createPublicObjectId(id)]?.surface).not.toBe('FRONT');
    }
    expect(confirm(null).success).toBe(false);
    expect(confirm('remaining-top').success).toBe(false);
    expect(confirm('drawn', P2).success).toBe(false);
    expect(
      session.executeCommand({
        ...createConfirmEffectStepCommand(P1, effectId),
        selectedCardIds: ['drawn', 'hand'],
      }).success
    ).toBe(false);
    expect(session.state!.players[0].hand.cardIds).toEqual(['hand', 'drawn']);

    expect(confirm('drawn').success).toBe(true);
    expect(session.state!.activeEffect).toBeNull();
    expect(session.state!.pendingAbilities).toEqual([]);
    expect(session.state!.players[0].hand.cardIds).toEqual(['hand']);
    expect(session.state!.players[0].mainDeck.cardIds).toEqual([
      'remaining-top',
      'remaining-bottom',
      'drawn',
    ]);
    expect(session.state!.players[0].waitingRoom.cardIds).toEqual([]);
    expect(session.state!.eventLog.map(({ event }) => event.eventType)).not.toContain(
      TriggerCondition.ON_ENTER_WAITING_ROOM
    );
    expect(
      session.getPlayerViewState(P2)!.objects[createPublicObjectId('drawn')]?.surface
    ).not.toBe('FRONT');
    expect(
      session.executeCommand(createConfirmEffectStepCommand(P1, effectId, 'drawn')).success
    ).toBe(false);
  });

  it('does not trigger when the owner fails and the opponent succeeds', () => {
    const { session, enter } = setup({ ownSuccess: false });
    expect(enter().success).toBe(true);
    expect(session.state!.eventLog.map(({ event }) => event)).toContainEqual(
      expect.objectContaining({ eventType: TriggerCondition.ON_LIVE_SUCCESS, playerId: P2 })
    );
    expect(session.state!.actionHistory.some(({ payload }) => payload.abilityId === ABILITY)).toBe(
      false
    );
    expect(session.state!.activeEffect).toBeNull();
    expect(session.state!.players[0].hand.cardIds).toEqual(['hand']);
    expect(session.state!.players[0].mainDeck.cardIds).toEqual([
      'drawn',
      'remaining-top',
      'remaining-bottom',
    ]);
  });

  it('keeps the existing hand choice mandatory when no card can be drawn', () => {
    const { session, enter, confirm } = setup({ deck: [] });
    expect(enter().success).toBe(true);
    expect(session.state!.activeEffect).toMatchObject({
      selectableCardIds: ['hand'],
      canSkipSelection: false,
    });
    expect(confirm(null).success).toBe(false);
    expect(confirm('hand').success).toBe(true);
    expect(session.state!.activeEffect).toBeNull();
    expect(session.state!.players[0].mainDeck.cardIds).toEqual(['hand']);
  });

  it('uses normal refresh before drawing from an empty main deck', () => {
    const { session, enter, confirm } = setup({ hand: [], deck: [], waitingRoom: ['refreshed'] });
    expect(enter().success).toBe(true);
    expect(session.state!.players[0].waitingRoom.cardIds).toEqual([]);
    expect(session.state!.players[0].hand.cardIds).toEqual(['refreshed']);
    expect(session.state!.activeEffect?.selectableCardIds).toEqual(['refreshed']);
    expect(confirm('refreshed').success).toBe(true);
    expect(session.state!.players[0].mainDeck.cardIds).toEqual(['refreshed']);
    expect(session.state!.players[0].hand.cardIds).toEqual([]);
  });

  it('finishes cleanly when no hand card exists after attempting to draw', () => {
    const { session, enter, confirm } = setup({ hand: [], deck: [] });
    expect(enter().success).toBe(true);
    expect(session.state!.activeEffect).toMatchObject({
      selectableCardIds: [],
      canSkipSelection: true,
    });
    expect(confirm().success).toBe(true);
    expect(session.state!.activeEffect).toBeNull();
    expect(session.state!.players[0].mainDeck.cardIds).toEqual([]);
  });

  it('rejects a stale hand card and keeps the valid card selectable without drawing again', () => {
    const { session, enter, confirm } = setup();
    expect(enter().success).toBe(true);
    const game = updatePlayer(session.state!, P1, (player) => ({
      ...player,
      hand: { ...player.hand, cardIds: ['drawn'] },
      waitingRoom: { ...player.waitingRoom, cardIds: ['hand'] },
    }));
    session.restoreRuntimeState({
      authorityState: game,
      currentPublicSeq: session.getCurrentPublicEventSeq(),
    });
    expect(confirm('hand').success).toBe(false);
    expect(session.state!.activeEffect?.abilityId).toBe(ABILITY);
    expect(session.state!.players[0].mainDeck.cardIds).toEqual([
      'remaining-top',
      'remaining-bottom',
    ]);
    expect(confirm('drawn').success).toBe(true);
    expect(session.state!.players[0].mainDeck.cardIds).toEqual([
      'remaining-top',
      'remaining-bottom',
      'drawn',
    ]);
  });
});

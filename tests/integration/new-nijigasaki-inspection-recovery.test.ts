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
import { placeCardInSlot } from '../../src/domain/entities/zone';
import { createEnterStageEvent } from '../../src/domain/events/game-events';
import { createConfirmEffectStepCommand } from '../../src/application/game-commands';
import { createGameSession, type GameSession } from '../../src/application/game-session';
import {
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  N_BP7_018_ON_ENTER_DISCARD_LOOK_TOP_FIVE_NO_BLADE_NIJIGASAKI_MEMBER_ABILITY_ID,
  N_SD2_009_ON_ENTER_LOOK_TOP_THREE_NIJIGASAKI_CARD_ABILITY_ID,
  N_SD2_011_ON_ENTER_DISCARD_RECOVER_NIJIGASAKI_LIVE_ABILITY_ID,
  N_SD2_012_ON_ENTER_DISCARD_LOOK_TOP_THREE_NIJIGASAKI_CARD_ABILITY_ID,
  N_SD2_014_ON_ENTER_DISCARD_LOOK_TOP_THREE_NIJIGASAKI_CARD_ABILITY_ID,
  SP_BP7_018_ON_ENTER_DISCARD_LIVE_LOOK_TOP_FIVE_TAKE_ONE_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import { PUBLIC_REVEAL_DWELL_STEP_ID } from '../../src/application/card-effects/runtime/public-reveal-dwell';
import { delegateWaitingRoomMemberOnEnterAbility } from '../../src/application/card-effects/workflows/shared/activate-waiting-room-member-on-enter-ability';
import { createPublicObjectId, projectPlayerViewState } from '../../src/online/projector';
import {
  BladeHeartEffect,
  CardType,
  FaceState,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
  ZoneType,
} from '../../src/shared/types/enums';
import {
  advancePublicRevealDwellIfNeeded,
  confirmPublicSelectionIfNeeded,
} from '../helpers/public-card-selection-confirmation';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

const N_BP7_018_EFFECT_TEXT =
  '【登场】可以将1张手牌放置入休息室：检视自己的卡组顶的5张卡片。可以从其中将1张不持有BLADE HEART的『虹咲』的成员卡公开并加入手牌。其余的放置入休息室。';
const N_SD2_009_EFFECT_TEXT =
  '【登场】检视自己的卡组顶的3张卡片。可以将1张其中的『虹咲』的卡片公开并加入手牌。其余的放置入休息室。';
const N_SD2_011_EFFECT_TEXT =
  '【登场】可以将1张手牌放置入休息室：从自己的休息室将1张『虹咲』的LIVE卡加入手牌。';
const N_SD2_012_EFFECT_TEXT =
  '【登场】可以将1张手牌放置入休息室：检视自己的卡组顶的3张卡，可以将其中的1张『虹咲』的卡片公开并加入手牌。其余的放置入休息室。';
const N_SD2_014_EFFECT_TEXT =
  '【登场】可以将1张手牌放置入休息室：检视自己的卡组顶的3张卡片。可以将其中的1张『虹咲』的卡片公开并加入手牌。其余的放置入休息室。';
const SP_BP7_018_EFFECT_TEXT =
  '【登场】可以将手牌的1张LIVE卡放置入休息室：检视自己的卡组顶的5张卡片。从其中将1张卡片加入手牌，其余的放置入休息室。';

function createMember(
  cardCode: string,
  options: {
    readonly name?: string;
    readonly groupNames?: readonly string[];
    readonly cost?: number;
    readonly bladeHeart?: boolean;
  } = {}
): MemberCardData {
  return {
    cardCode,
    name: options.name ?? cardCode,
    groupNames: options.groupNames ?? ['虹ヶ咲学園スクールアイドル同好会'],
    cardType: CardType.MEMBER,
    cost: options.cost ?? 4,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
    ...(options.bladeHeart ? { bladeHearts: [{ effect: BladeHeartEffect.DRAW, value: 1 }] } : {}),
  };
}

function createLive(
  cardCode: string,
  options: { readonly name?: string; readonly groupNames?: readonly string[] } = {}
): LiveCardData {
  return {
    cardCode,
    name: options.name ?? cardCode,
    groupNames: options.groupNames ?? ['虹ヶ咲学園スクールアイドル同好会'],
    cardType: CardType.LIVE,
    score: 3,
    requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
  };
}

function createSessionWithState(game: GameState, sessionId: string): GameSession {
  const session = createGameSession();
  session.createGame(sessionId, PLAYER1, 'P1', PLAYER2, 'P2');
  (session as unknown as { authorityState: GameState }).authorityState = game;
  return session;
}

function setupOnEnter(params: {
  readonly sessionId: string;
  readonly source: ReturnType<typeof createCardInstance>;
  readonly handCards?: readonly ReturnType<typeof createCardInstance>[];
  readonly mainDeckCards?: readonly ReturnType<typeof createCardInstance>[];
  readonly waitingRoomCards?: readonly ReturnType<typeof createCardInstance>[];
}): GameSession {
  const handCards = params.handCards ?? [];
  const mainDeckCards = params.mainDeckCards ?? [];
  const waitingRoomCards = params.waitingRoomCards ?? [];
  let game = createGameState(params.sessionId, PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [params.source, ...handCards, ...mainDeckCards, ...waitingRoomCards]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    hand: { ...player.hand, cardIds: handCards.map((card) => card.instanceId) },
    mainDeck: { ...player.mainDeck, cardIds: mainDeckCards.map((card) => card.instanceId) },
    waitingRoom: {
      ...player.waitingRoom,
      cardIds: waitingRoomCards.map((card) => card.instanceId),
    },
    memberSlots: placeCardInSlot(
      player.memberSlots,
      SlotPosition.CENTER,
      params.source.instanceId,
      {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }
    ),
  }));
  game = emitGameEvent(
    game,
    createEnterStageEvent(
      params.source.instanceId,
      ZoneType.HAND,
      SlotPosition.CENTER,
      PLAYER1,
      PLAYER1
    )
  );
  game = enqueueTriggeredCardEffects(game, [TriggerCondition.ON_ENTER_STAGE]);
  return createSessionWithState(resolvePendingCardEffects(game).gameState, params.sessionId);
}

function setupDelegatedOnEnter(params: {
  readonly sessionId: string;
  readonly delegatedSource: ReturnType<typeof createCardInstance>;
  readonly delegatedAbilityId: string;
  readonly handCards?: readonly ReturnType<typeof createCardInstance>[];
  readonly mainDeckCards?: readonly ReturnType<typeof createCardInstance>[];
}): GameSession {
  const handCards = params.handCards ?? [];
  const mainDeckCards = params.mainDeckCards ?? [];
  let game = createGameState(params.sessionId, PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [params.delegatedSource, ...handCards, ...mainDeckCards]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    hand: { ...player.hand, cardIds: handCards.map((card) => card.instanceId) },
    mainDeck: { ...player.mainDeck, cardIds: mainDeckCards.map((card) => card.instanceId) },
    waitingRoom: { ...player.waitingRoom, cardIds: [params.delegatedSource.instanceId] },
  }));
  game = delegateWaitingRoomMemberOnEnterAbility(
    game,
    {
      controllerId: PLAYER1,
      parentAbilityId: 'test:delegate-waiting-room-on-enter',
      parentSourceCardId: 'test-delegation-host',
      parentEffectId: `${params.sessionId}:parent-effect`,
      targetCardId: params.delegatedSource.instanceId,
      delegatedAbilityId: params.delegatedAbilityId,
      orderedResolution: false,
    },
    (state, ability) =>
      resolvePendingCardEffects({
        ...state,
        pendingAbilities: [...state.pendingAbilities, ability],
      }).gameState
  );
  return createSessionWithState(game, params.sessionId);
}

function confirmCard(session: GameSession, cardId: string | null) {
  return session.executeCommand(
    createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, cardId)
  );
}

describe('new Nijigasaki discard/look-top family extensions', () => {
  it('PL!N-bp7-018 only offers a no-BLADE-HEART Nijigasaki member and dwells before moving it', () => {
    const source = createCardInstance(createMember('PL!N-bp7-018-N'), PLAYER1, 'n-bp7-018-source');
    const discard = createCardInstance(createMember('discard'), PLAYER1, 'n-bp7-018-discard');
    const valid = createCardInstance(createMember('niji-no-blade-heart'), PLAYER1, 'n-bp7-valid');
    const bladeHeart = createCardInstance(
      createMember('niji-blade-heart', { bladeHeart: true }),
      PLAYER1,
      'n-bp7-blade-heart'
    );
    const otherGroup = createCardInstance(
      createMember('liella-member', { groupNames: ['Liella!'] }),
      PLAYER1,
      'n-bp7-other-group'
    );
    const nijiLive = createCardInstance(createLive('niji-live'), PLAYER1, 'n-bp7-niji-live');
    const filler = createCardInstance(
      createMember('filler', { groupNames: ['Liella!'] }),
      PLAYER1,
      'n-bp7-filler'
    );
    const sentinel = createCardInstance(createMember('sentinel'), PLAYER1, 'n-bp7-sentinel');
    const session = setupOnEnter({
      sessionId: 'n-bp7-018-look-top',
      source,
      handCards: [discard],
      mainDeckCards: [valid, bladeHeart, otherGroup, nijiLive, filler, sentinel],
    });

    expect(session.state?.activeEffect).toMatchObject({
      abilityId: N_BP7_018_ON_ENTER_DISCARD_LOOK_TOP_FIVE_NO_BLADE_NIJIGASAKI_MEMBER_ABILITY_ID,
      effectText: N_BP7_018_EFFECT_TEXT,
      selectableCardIds: [discard.instanceId],
      selectionLabel: '请选择要放置入休息室的卡牌',
      confirmSelectionLabel: '放置入休息室',
      skipSelectionLabel: '不发动',
    });
    expect(confirmCard(session, discard.instanceId).success).toBe(true);
    expect(session.state?.activeEffect).toMatchObject({
      effectText: N_BP7_018_EFFECT_TEXT,
      selectableCardIds: [valid.instanceId],
      selectionLabel: '选择要公开并加入手牌的虹咲成员卡',
      confirmSelectionLabel: '公开并加入手牌',
      skipSelectionLabel: '全部放置入休息室',
    });
    const opponentSelectingView = projectPlayerViewState(session.state!, PLAYER2);
    expect(opponentSelectingView.activeEffect?.selectableObjectIds).toBeUndefined();
    expect(opponentSelectingView.objects[createPublicObjectId(valid.instanceId)]?.surface).toBe(
      'BACK'
    );
    expect(confirmCard(session, bladeHeart.instanceId).success).toBe(false);
    expect(confirmCard(session, valid.instanceId).success).toBe(true);
    expect(session.state?.activeEffect?.stepId).toBe(PUBLIC_REVEAL_DWELL_STEP_ID);
    expect(session.state?.inspectionZone.revealedCardIds).toEqual([valid.instanceId]);
    expect(session.state?.players[0].hand.cardIds).not.toContain(valid.instanceId);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([discard.instanceId]);
    expect(
      projectPlayerViewState(session.state!, PLAYER2).objects[
        createPublicObjectId(valid.instanceId)
      ]?.surface
    ).toBe('FRONT');
    expect(advancePublicRevealDwellIfNeeded(session)?.success).toBe(true);
    expect(session.state?.players[0].hand.cardIds).toEqual([valid.instanceId]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual(
      expect.arrayContaining([
        discard.instanceId,
        bladeHeart.instanceId,
        otherGroup.instanceId,
        nijiLive.instanceId,
        filler.instanceId,
      ])
    );
  });

  for (const cardCase of [
    {
      cardCode: 'PL!N-sd2-012-SD2',
      abilityId: N_SD2_012_ON_ENTER_DISCARD_LOOK_TOP_THREE_NIJIGASAKI_CARD_ABILITY_ID,
      effectText: N_SD2_012_EFFECT_TEXT,
    },
    {
      cardCode: 'PL!N-sd2-014-SD2',
      abilityId: N_SD2_014_ON_ENTER_DISCARD_LOOK_TOP_THREE_NIJIGASAKI_CARD_ABILITY_ID,
      effectText: N_SD2_014_EFFECT_TEXT,
    },
  ] as const) {
    it(`${cardCase.cardCode} discards one, inspects three, and publicly takes an optional Nijigasaki card`, () => {
      const source = createCardInstance(
        createMember(cardCase.cardCode),
        PLAYER1,
        `${cardCase.cardCode}-source`
      );
      const discard = createCardInstance(
        createMember('discard'),
        PLAYER1,
        `${cardCase.cardCode}-discard`
      );
      const nijiMember = createCardInstance(
        createMember('niji-member'),
        PLAYER1,
        `${cardCase.cardCode}-niji-member`
      );
      const otherCard = createCardInstance(
        createLive('other-live', { groupNames: ['Liella!'] }),
        PLAYER1,
        `${cardCase.cardCode}-other`
      );
      const nijiLive = createCardInstance(
        createLive('niji-live'),
        PLAYER1,
        `${cardCase.cardCode}-niji-live`
      );
      const sentinel = createCardInstance(
        createMember('sentinel'),
        PLAYER1,
        `${cardCase.cardCode}-sentinel`
      );
      const session = setupOnEnter({
        sessionId: `${cardCase.cardCode}-look-top`,
        source,
        handCards: [discard],
        mainDeckCards: [nijiMember, otherCard, nijiLive, sentinel],
      });

      expect(session.state?.activeEffect).toMatchObject({
        abilityId: cardCase.abilityId,
        effectText: cardCase.effectText,
        selectableCardIds: [discard.instanceId],
      });
      expect(confirmCard(session, discard.instanceId).success).toBe(true);
      expect(session.state?.activeEffect).toMatchObject({
        effectText: cardCase.effectText,
        inspectionCardIds: [nijiMember.instanceId, otherCard.instanceId, nijiLive.instanceId],
        selectableCardIds: [nijiMember.instanceId, nijiLive.instanceId],
        selectionLabel: '选择要公开并加入手牌的虹咲卡',
        confirmSelectionLabel: '公开并加入手牌',
        skipSelectionLabel: '全部放置入休息室',
      });
      expect(confirmCard(session, nijiLive.instanceId).success).toBe(true);
      expect(session.state?.activeEffect?.stepId).toBe(PUBLIC_REVEAL_DWELL_STEP_ID);
      expect(advancePublicRevealDwellIfNeeded(session)?.success).toBe(true);
      expect(session.state?.players[0].hand.cardIds).toEqual([nijiLive.instanceId]);
      expect(session.state?.players[0].waitingRoom.cardIds).toEqual(
        expect.arrayContaining([discard.instanceId, nijiMember.instanceId, otherCard.instanceId])
      );
    });
  }
});

describe('PL!N-sd2-009 look-top shared family extension', () => {
  it('inspects three, keeps the inspection private, and publicly takes an optional Nijigasaki card', () => {
    const source = createCardInstance(
      createMember('PL!N-sd2-009-SD2'),
      PLAYER1,
      'n-sd2-009-source'
    );
    const nijiMember = createCardInstance(createMember('niji-member'), PLAYER1, 'n-sd2-009-niji');
    const other = createCardInstance(
      createMember('other-member', { groupNames: ['Liella!'] }),
      PLAYER1,
      'n-sd2-009-other'
    );
    const nijiLive = createCardInstance(createLive('niji-live'), PLAYER1, 'n-sd2-009-live');
    const sentinel = createCardInstance(createMember('sentinel'), PLAYER1, 'n-sd2-009-sentinel');
    const session = setupOnEnter({
      sessionId: 'n-sd2-009-look-top',
      source,
      mainDeckCards: [nijiMember, other, nijiLive, sentinel],
    });

    expect(session.state?.activeEffect).toMatchObject({
      abilityId: N_SD2_009_ON_ENTER_LOOK_TOP_THREE_NIJIGASAKI_CARD_ABILITY_ID,
      effectText: N_SD2_009_EFFECT_TEXT,
      inspectionCardIds: [nijiMember.instanceId, other.instanceId, nijiLive.instanceId],
      selectableCardIds: [nijiMember.instanceId, nijiLive.instanceId],
      selectionLabel: '选择要公开并加入手牌的虹咲卡',
      confirmSelectionLabel: '公开并加入手牌',
      skipSelectionLabel: '全部放置入休息室',
    });
    expect(
      projectPlayerViewState(session.state!, PLAYER2).activeEffect?.selectableObjectIds
    ).toBeUndefined();
    expect(confirmCard(session, nijiMember.instanceId).success).toBe(true);
    expect(session.state?.activeEffect?.stepId).toBe(PUBLIC_REVEAL_DWELL_STEP_ID);
    expect(advancePublicRevealDwellIfNeeded(session)?.success).toBe(true);
    expect(session.state?.players[0].hand.cardIds).toEqual([nijiMember.instanceId]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([
      other.instanceId,
      nijiLive.instanceId,
    ]);
  });

  it('consumes the pending ability without opening a selection when no cards can be inspected', () => {
    const source = createCardInstance(
      createMember('PL!N-sd2-009-SD2'),
      PLAYER1,
      'n-sd2-009-empty-source'
    );
    const session = setupOnEnter({ sessionId: 'n-sd2-009-empty', source });

    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.pendingAbilities).toEqual([]);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            N_SD2_009_ON_ENTER_LOOK_TOP_THREE_NIJIGASAKI_CARD_ABILITY_ID &&
          action.payload.inspectedCardIds instanceof Array &&
          action.payload.inspectedCardIds.length === 0
      )
    ).toBe(true);
  });
});

describe('PL!N-sd2-011 discard/recover shared family extension', () => {
  it('recovers the selected Nijigasaki LIVE after the public selection confirmation', () => {
    const source = createCardInstance(
      createMember('PL!N-sd2-011-SD2'),
      PLAYER1,
      'n-sd2-011-success-source'
    );
    const discard = createCardInstance(
      createMember('discard'),
      PLAYER1,
      'n-sd2-011-success-discard'
    );
    const target = createCardInstance(createLive('niji-live'), PLAYER1, 'n-sd2-011-success-target');
    const session = setupOnEnter({
      sessionId: 'n-sd2-011-success',
      source,
      handCards: [discard],
      waitingRoomCards: [target],
    });

    expect(confirmCard(session, discard.instanceId).success).toBe(true);
    expect(confirmCard(session, target.instanceId).success).toBe(true);
    confirmPublicSelectionIfNeeded(session);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toEqual([target.instanceId]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([discard.instanceId]);
  });

  it('pays the discard cost first and only offers a current own Nijigasaki LIVE', () => {
    const source = createCardInstance(
      createMember('PL!N-sd2-011-SD2'),
      PLAYER1,
      'n-sd2-011-source'
    );
    const discard = createCardInstance(createMember('discard'), PLAYER1, 'n-sd2-011-discard');
    const target = createCardInstance(createLive('niji-live'), PLAYER1, 'n-sd2-011-target');
    const nijiMember = createCardInstance(createMember('niji-member'), PLAYER1, 'n-sd2-011-member');
    const otherLive = createCardInstance(
      createLive('other-live', { groupNames: ['Liella!'] }),
      PLAYER1,
      'n-sd2-011-other-live'
    );
    const session = setupOnEnter({
      sessionId: 'n-sd2-011-recover',
      source,
      handCards: [discard],
      waitingRoomCards: [target, nijiMember, otherLive],
    });

    expect(session.state?.activeEffect).toMatchObject({
      abilityId: N_SD2_011_ON_ENTER_DISCARD_RECOVER_NIJIGASAKI_LIVE_ABILITY_ID,
      effectText: N_SD2_011_EFFECT_TEXT,
      selectableCardIds: [discard.instanceId],
      selectionLabel: '选择要放置入休息室的手牌',
      confirmSelectionLabel: '放置入休息室',
      skipSelectionLabel: '不发动',
    });
    expect(confirmCard(session, discard.instanceId).success).toBe(true);
    expect(session.state?.activeEffect).toMatchObject({
      effectText: N_SD2_011_EFFECT_TEXT,
      selectableCardIds: [target.instanceId],
      selectionLabel: '选择要加入手牌的虹咲LIVE卡',
      confirmSelectionLabel: '加入手牌',
      canSkipSelection: false,
    });

    const staleState = updatePlayer(session.state!, PLAYER1, (player) => ({
      ...player,
      waitingRoom: {
        ...player.waitingRoom,
        cardIds: player.waitingRoom.cardIds.filter((cardId) => cardId !== target.instanceId),
      },
    }));
    (session as unknown as { authorityState: GameState }).authorityState = staleState;
    expect(confirmCard(session, target.instanceId).success).toBe(false);
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([target.instanceId]);
    expect(session.state?.players[0].waitingRoom.cardIds).toContain(discard.instanceId);
  });

  it('keeps the paid discard when no recovery target exists after payment', () => {
    const source = createCardInstance(
      createMember('PL!N-sd2-011-SD2'),
      PLAYER1,
      'n-sd2-011-no-target-source'
    );
    const discard = createCardInstance(
      createMember('discard'),
      PLAYER1,
      'n-sd2-011-no-target-discard'
    );
    const session = setupOnEnter({
      sessionId: 'n-sd2-011-no-target',
      source,
      handCards: [discard],
    });

    expect(confirmCard(session, discard.instanceId).success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toEqual([]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([discard.instanceId]);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'PAY_COST' &&
          action.payload.abilityId === N_SD2_011_ON_ENTER_DISCARD_RECOVER_NIJIGASAKI_LIVE_ABILITY_ID
      )
    ).toBe(true);
    expect(session.state?.actionHistory.at(-1)).toMatchObject({
      type: 'RESOLVE_ABILITY',
      payload: {
        abilityId: N_SD2_011_ON_ENTER_DISCARD_RECOVER_NIJIGASAKI_LIVE_ABILITY_ID,
        reason: 'NO_NIJIGASAKI_LIVE_TARGET',
      },
    });
  });
});

describe('PL!SP-bp7-018 LIVE-discard look-top family extension', () => {
  it('only accepts a LIVE cost, then forces exactly one inspected card into hand without revealing it', () => {
    const source = createCardInstance(
      createMember('PL!SP-bp7-018-N', { groupNames: ['Liella!'] }),
      PLAYER1,
      'sp-bp7-018-source'
    );
    const liveCost = createCardInstance(
      createLive('live-cost', { groupNames: ['Liella!'] }),
      PLAYER1,
      'sp-bp7-018-live-cost'
    );
    const memberCost = createCardInstance(
      createMember('member-cost', { groupNames: ['Liella!'] }),
      PLAYER1,
      'sp-bp7-018-member-cost'
    );
    const topCards = Array.from({ length: 6 }, (_, index) =>
      createCardInstance(
        createMember(`top-${index}`, { groupNames: index % 2 === 0 ? ['Liella!'] : ['Aqours'] }),
        PLAYER1,
        `sp-bp7-018-top-${index}`
      )
    );
    const session = setupOnEnter({
      sessionId: 'sp-bp7-018-look-top',
      source,
      handCards: [memberCost, liveCost],
      mainDeckCards: topCards,
    });

    expect(session.state?.activeEffect).toMatchObject({
      abilityId: SP_BP7_018_ON_ENTER_DISCARD_LIVE_LOOK_TOP_FIVE_TAKE_ONE_ABILITY_ID,
      effectText: SP_BP7_018_EFFECT_TEXT,
      selectableCardIds: [liveCost.instanceId],
      selectionLabel: '请选择要放置入休息室的卡牌',
      confirmSelectionLabel: '放置入休息室',
      skipSelectionLabel: '不发动',
    });
    expect(confirmCard(session, memberCost.instanceId).success).toBe(false);
    expect(confirmCard(session, liveCost.instanceId).success).toBe(true);
    expect(session.state?.activeEffect).toMatchObject({
      effectText: SP_BP7_018_EFFECT_TEXT,
      inspectionCardIds: topCards.slice(0, 5).map((card) => card.instanceId),
      selectableCardIds: topCards.slice(0, 5).map((card) => card.instanceId),
      selectionLabel: '请选择要加入手牌的卡牌',
      confirmSelectionLabel: '加入手牌',
      canSkipSelection: false,
    });
    expect(confirmCard(session, null).success).toBe(false);
    expect(confirmCard(session, topCards[2]!.instanceId).success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.inspectionZone.revealedCardIds).toEqual([]);
    expect(session.state?.players[0].hand.cardIds).toEqual([
      memberCost.instanceId,
      topCards[2]!.instanceId,
    ]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([
      liveCost.instanceId,
      topCards[0]!.instanceId,
      topCards[1]!.instanceId,
      topCards[3]!.instanceId,
      topCards[4]!.instanceId,
    ]);
  });

  it('clamps to the available cards after check-top refresh and still forces one selection', () => {
    const source = createCardInstance(
      createMember('PL!SP-bp7-018-N', { groupNames: ['Liella!'] }),
      PLAYER1,
      'sp-bp7-018-short-source'
    );
    const liveCost = createCardInstance(
      createLive('live-cost', { groupNames: ['Liella!'] }),
      PLAYER1,
      'sp-bp7-018-short-live-cost'
    );
    const topCards = [
      createCardInstance(createMember('short-top-0'), PLAYER1, 'sp-bp7-018-short-0'),
      createCardInstance(createMember('short-top-1'), PLAYER1, 'sp-bp7-018-short-1'),
    ];
    const session = setupOnEnter({
      sessionId: 'sp-bp7-018-short',
      source,
      handCards: [liveCost],
      mainDeckCards: topCards,
    });

    expect(confirmCard(session, liveCost.instanceId).success).toBe(true);
    expect(session.state?.activeEffect?.inspectionCardIds).toHaveLength(3);
    expect(new Set(session.state?.activeEffect?.inspectionCardIds)).toEqual(
      new Set([liveCost.instanceId, ...topCards.map((card) => card.instanceId)])
    );
    expect(session.state?.activeEffect).toMatchObject({
      minSelectableCards: undefined,
      maxSelectableCards: undefined,
      canSkipSelection: false,
    });
    const selectedCardId = session.state!.activeEffect!.inspectionCardIds![0]!;
    expect(confirmCard(session, selectedCardId).success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toEqual([selectedCardId]);
  });

  it('does not open an illegal cost window when the hand has no LIVE card', () => {
    const source = createCardInstance(
      createMember('PL!SP-bp7-018-N', { groupNames: ['Liella!'] }),
      PLAYER1,
      'sp-bp7-018-no-live-source'
    );
    const member = createCardInstance(
      createMember('member-only', { groupNames: ['Liella!'] }),
      PLAYER1,
      'sp-bp7-018-member-only'
    );
    const session = setupOnEnter({
      sessionId: 'sp-bp7-018-no-live',
      source,
      handCards: [member],
    });

    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toEqual([member.instanceId]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([]);
  });
});

describe('waiting-room delegated execution for the new low-cost ON_ENTER effects', () => {
  it('delegates PL!N-bp7-018 with the waiting-room card as source through discard, reveal, and finish', () => {
    const delegatedSource = createCardInstance(
      createMember('PL!N-bp7-018-N'),
      PLAYER1,
      'delegated-n-bp7-018-source'
    );
    const discard = createCardInstance(
      createMember('discard'),
      PLAYER1,
      'delegated-n-bp7-018-discard'
    );
    const selected = createCardInstance(
      createMember('selected'),
      PLAYER1,
      'delegated-n-bp7-018-selected'
    );
    const deckCards = [
      selected,
      ...Array.from({ length: 5 }, (_, index) =>
        createCardInstance(
          createMember(`other-${index}`, { groupNames: ['Liella!'] }),
          PLAYER1,
          `delegated-n-bp7-018-other-${index}`
        )
      ),
    ];
    const session = setupDelegatedOnEnter({
      sessionId: 'delegated-n-bp7-018',
      delegatedSource,
      delegatedAbilityId:
        N_BP7_018_ON_ENTER_DISCARD_LOOK_TOP_FIVE_NO_BLADE_NIJIGASAKI_MEMBER_ABILITY_ID,
      handCards: [discard],
      mainDeckCards: deckCards,
    });

    expect(session.state?.activeEffect).toMatchObject({
      abilityId: N_BP7_018_ON_ENTER_DISCARD_LOOK_TOP_FIVE_NO_BLADE_NIJIGASAKI_MEMBER_ABILITY_ID,
      sourceCardId: delegatedSource.instanceId,
      effectText: N_BP7_018_EFFECT_TEXT,
      selectableCardIds: [discard.instanceId],
    });
    expect(session.state?.players[0].waitingRoom.cardIds).toContain(delegatedSource.instanceId);
    expect(confirmCard(session, discard.instanceId).success).toBe(true);
    expect(confirmCard(session, selected.instanceId).success).toBe(true);
    expect(session.state?.activeEffect?.stepId).toBe(PUBLIC_REVEAL_DWELL_STEP_ID);
    expect(advancePublicRevealDwellIfNeeded(session)?.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toEqual([selected.instanceId]);
    expect(session.state?.players[0].waitingRoom.cardIds).toContain(delegatedSource.instanceId);
    expect(
      session.state?.eventLog.some(
        (entry) =>
          entry.event.eventType === TriggerCondition.ON_ENTER_STAGE &&
          entry.event.cardInstanceId === delegatedSource.instanceId
      )
    ).toBe(false);
  });

  it('delegates PL!N-sd2-012 through its top-three public selection flow', () => {
    const delegatedSource = createCardInstance(
      createMember('PL!N-sd2-012-SD2'),
      PLAYER1,
      'delegated-n-sd2-012-source'
    );
    const discard = createCardInstance(
      createMember('discard'),
      PLAYER1,
      'delegated-n-sd2-012-discard'
    );
    const selected = createCardInstance(
      createLive('selected'),
      PLAYER1,
      'delegated-n-sd2-012-selected'
    );
    const other = createCardInstance(
      createMember('other', { groupNames: ['Liella!'] }),
      PLAYER1,
      'delegated-n-sd2-012-other'
    );
    const remainder = createCardInstance(
      createMember('remainder'),
      PLAYER1,
      'delegated-n-sd2-012-remainder'
    );
    const sentinel = createCardInstance(
      createMember('sentinel'),
      PLAYER1,
      'delegated-n-sd2-012-sentinel'
    );
    const session = setupDelegatedOnEnter({
      sessionId: 'delegated-n-sd2-012',
      delegatedSource,
      delegatedAbilityId: N_SD2_012_ON_ENTER_DISCARD_LOOK_TOP_THREE_NIJIGASAKI_CARD_ABILITY_ID,
      handCards: [discard],
      mainDeckCards: [selected, other, remainder, sentinel],
    });

    expect(session.state?.activeEffect).toMatchObject({
      abilityId: N_SD2_012_ON_ENTER_DISCARD_LOOK_TOP_THREE_NIJIGASAKI_CARD_ABILITY_ID,
      sourceCardId: delegatedSource.instanceId,
      effectText: N_SD2_012_EFFECT_TEXT,
      selectableCardIds: [discard.instanceId],
    });
    expect(confirmCard(session, discard.instanceId).success).toBe(true);
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([
      selected.instanceId,
      remainder.instanceId,
    ]);
    expect(confirmCard(session, selected.instanceId).success).toBe(true);
    expect(advancePublicRevealDwellIfNeeded(session)?.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toEqual([selected.instanceId]);
    expect(session.state?.players[0].waitingRoom.cardIds).toContain(delegatedSource.instanceId);
  });

  it('delegates PL!SP-bp7-018 through its LIVE-only cost and mandatory private take', () => {
    const delegatedSource = createCardInstance(
      createMember('PL!SP-bp7-018-N', { groupNames: ['Liella!'] }),
      PLAYER1,
      'delegated-sp-bp7-018-source'
    );
    const liveCost = createCardInstance(
      createLive('live-cost', { groupNames: ['Liella!'] }),
      PLAYER1,
      'delegated-sp-bp7-018-live-cost'
    );
    const memberInHand = createCardInstance(
      createMember('member-in-hand', { groupNames: ['Liella!'] }),
      PLAYER1,
      'delegated-sp-bp7-018-member-in-hand'
    );
    const deckCards = Array.from({ length: 6 }, (_, index) =>
      createCardInstance(
        createMember(`deck-${index}`, { groupNames: ['Liella!'] }),
        PLAYER1,
        `delegated-sp-bp7-018-deck-${index}`
      )
    );
    const session = setupDelegatedOnEnter({
      sessionId: 'delegated-sp-bp7-018',
      delegatedSource,
      delegatedAbilityId: SP_BP7_018_ON_ENTER_DISCARD_LIVE_LOOK_TOP_FIVE_TAKE_ONE_ABILITY_ID,
      handCards: [memberInHand, liveCost],
      mainDeckCards: deckCards,
    });

    expect(session.state?.activeEffect).toMatchObject({
      abilityId: SP_BP7_018_ON_ENTER_DISCARD_LIVE_LOOK_TOP_FIVE_TAKE_ONE_ABILITY_ID,
      sourceCardId: delegatedSource.instanceId,
      effectText: SP_BP7_018_EFFECT_TEXT,
      selectableCardIds: [liveCost.instanceId],
    });
    expect(confirmCard(session, liveCost.instanceId).success).toBe(true);
    expect(session.state?.activeEffect).toMatchObject({
      selectableCardIds: deckCards.slice(0, 5).map((card) => card.instanceId),
      canSkipSelection: false,
    });
    expect(confirmCard(session, deckCards[4]!.instanceId).success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.inspectionZone.revealedCardIds).toEqual([]);
    expect(session.state?.players[0].hand.cardIds).toEqual([
      memberInHand.instanceId,
      deckCards[4]!.instanceId,
    ]);
    expect(session.state?.players[0].waitingRoom.cardIds).toContain(delegatedSource.instanceId);
  });
});

import { describe, expect, it } from 'vitest';
import { moveCardUniversal } from '../../src/application/action-handlers/zone-operations';
import {
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  HS_PR_044_CONTINUOUS_HIGH_COST_STAGE_ORIGINAL_BLADE_THREE_ABILITY_ID as KOSUZU,
  S_BP7_005_ACTIVATED_DISCARD_TWO_DELEGATE_TWO_ON_ENTER_ABILITY_ID as DELEGATING_YOU,
  S_CL1_009_ACTIVATED_SELF_SACRIFICE_RECOVER_MEMBER_ABILITY_ID as DIA,
  S_PB2_014_ON_ENTER_OTHER_CYARON_BOTH_PLACE_WAITING_ENERGY_ABILITY_ID as YOU,
  S_PB2_019_ON_ENTER_OPPONENT_DRAW_TWO_GAIN_RED_HEARTS_ABILITY_ID as CHIKA,
  S_PB2_021_ACTIVATED_DISCARD_REPLACE_ORIGINAL_HEARTS_GREEN_ABILITY_ID as KANAN_ACTIVATED,
  S_PB2_021_CONTINUOUS_AZALEA_GREEN_TEN_GAIN_BLADE_ABILITY_ID as KANAN_CONTINUOUS,
} from '../../src/application/card-effects/ability-ids';
import { getCardAbilityDefinitionsForCardCode } from '../../src/application/card-effects/definitions/lookup';
import { getStageMemberDelegatableOnEnterDefinitions } from '../../src/application/card-effects/runtime/delegatable-definitions';
import { playMemberFromZoneToEmptySlot } from '../../src/application/card-effects/runtime/play-member-to-stage';
import { PUBLIC_CARD_SELECTION_CONFIRMATION_STEP_ID } from '../../src/application/card-effects/runtime/public-card-selection-confirmation';
import {
  createActivateAbilityCommand,
  createAutoAdvancePublicCardSelectionCommand,
  createConfirmEffectStepCommand,
} from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
  type CardInstance,
  type LiveCardData,
  type MemberCardData,
} from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import { addMemberBelowMember, placeCardInSlot } from '../../src/domain/entities/zone';
import {
  addLiveModifier,
  collectLiveModifiers,
  getMemberEffectiveBladeCount,
  getMemberEffectiveHeartIcons,
  getMemberOriginalBladeCount,
  getMemberOriginalHeartIcons,
  removeStageMemberBoundLiveModifiers,
} from '../../src/domain/rules/live-modifiers';
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
  ZoneType,
} from '../../src/shared/types/enums';
import { getNovember20MemberData } from '../helpers/november-20-draft-effects';
import { getNovember27MemberData } from '../helpers/november-27-draft-effects';

const P1 = 'p1';
const P2 = 'p2';
const GREEN = HeartColor.GREEN;
const RED = HeartColor.RED;
const BLUE = HeartColor.BLUE;
const CENTER = SlotPosition.CENTER;
const LEFT = SlotPosition.LEFT;
const RIGHT = SlotPosition.RIGHT;

function fixture(base: string, id: string) {
  return createCardInstance(getNovember27MemberData(base), P1, id);
}

function member(id: string, data: Partial<MemberCardData> = {}, owner = P1) {
  const memberData: MemberCardData = {
    cardCode: id,
    name: id,
    cardType: CardType.MEMBER,
    groupNames: ['Aqours'],
    cost: 3,
    blade: 0,
    hearts: [],
    ...data,
  };
  return createCardInstance(memberData, owner, id);
}

function energy(id: string, owner: string) {
  return createCardInstance({ cardCode: id, name: id, cardType: CardType.ENERGY }, owner, id);
}

function live(id: string) {
  const data: LiveCardData = {
    cardCode: id,
    name: id,
    cardType: CardType.LIVE,
    groupNames: ['Aqours'],
    score: 1,
    requirements: createHeartRequirement({ [GREEN]: 1 }),
  };
  return createCardInstance(data, P1, id);
}

function gameWith(...cards: CardInstance[]): GameState {
  const ownDeckCard = member('own-deck-filler');
  const opponentDeckCard = member('opponent-deck-filler', {}, P2);
  let game = registerCards(createGameState('november-27-stage-members', P1, 'P1', P2, 'P2'), [
    ownDeckCard,
    opponentDeckCard,
    ...cards,
  ]);
  for (const filler of [ownDeckCard, opponentDeckCard]) {
    game = updatePlayer(game, filler.ownerId, (player) => ({
      ...player,
      mainDeck: { ...player.mainDeck, cardIds: [filler.instanceId] },
    }));
  }
  return {
    ...game,
    activePlayerIndex: 0,
    currentPhase: GamePhase.MAIN_PHASE,
    currentSubPhase: SubPhase.NONE,
    currentTurnType: TurnType.FIRST_PLAYER_TURN,
  };
}

function stage(
  game: GameState,
  card: CardInstance,
  slot = CENTER,
  orientation = OrientationState.ACTIVE
) {
  return updatePlayer(game, card.ownerId, (player) => ({
    ...player,
    memberSlots: placeCardInSlot(player.memberSlots, slot, card.instanceId, {
      orientation,
      face: FaceState.FACE_UP,
    }),
  }));
}

function enter(game: GameState, source: CardInstance, slot = CENTER) {
  const hand = updatePlayer(game, P1, (player) => ({
    ...player,
    hand: { ...player.hand, cardIds: [...player.hand.cardIds, source.instanceId] },
  }));
  const placed = playMemberFromZoneToEmptySlot(hand, P1, {
    cardId: source.instanceId,
    sourceZone: ZoneType.HAND,
    toSlot: slot,
  })!;
  return enqueueTriggeredCardEffects(placed.gameState, [TriggerCondition.ON_ENTER_STAGE], {
    enterStageEvents: [placed.enterStageEvent],
  });
}

function sessionFor(game: GameState, now = () => 10_000) {
  const session = createGameSession({ now });
  session.restoreRuntimeState({ authorityState: game, currentPublicSeq: 0 });
  return session;
}

function events(game: GameState, type: TriggerCondition) {
  return game.eventLog.flatMap(({ event }) => (event.eventType === type ? [event] : []));
}

describe('PL!HS-PR-044 费用4「徒町小铃」', () => {
  it('reads current effective cost, excludes opponents and members below, and sets original Blade before additions', () => {
    const kosuzu = fixture('PL!HS-PR-044', 'kosuzu');
    const twelve = member('twelve', { cost: 12 });
    const underneath = member('underneath', { cost: 13 });
    const opponent = member('opponent', { cost: 13 }, P2);
    let game = stage(
      stage(
        stage(gameWith(kosuzu, twelve, underneath, opponent), kosuzu),
        twelve,
        LEFT,
        OrientationState.WAITING
      ),
      opponent
    );
    game = updatePlayer(game, P1, (player) => ({
      ...player,
      memberSlots: addMemberBelowMember(player.memberSlots, LEFT, underneath.instanceId),
    }));
    expect(getMemberOriginalBladeCount(game, P1, kosuzu.instanceId)).toBe(1);
    const qualified = addLiveModifier(game, {
      kind: 'MEMBER_COST',
      playerId: P1,
      memberCardId: twelve.instanceId,
      countDelta: 1,
    });
    expect(getMemberOriginalBladeCount(qualified, P1, kosuzu.instanceId)).toBe(3);
    const boosted = addLiveModifier(qualified, {
      kind: 'BLADE',
      target: 'SOURCE_MEMBER',
      playerId: P1,
      sourceCardId: kosuzu.instanceId,
      countDelta: 2,
    });
    expect(getMemberEffectiveBladeCount(boosted, P1, kosuzu.instanceId)).toBe(5);
    const fixedLater = addLiveModifier(boosted, {
      kind: 'MEMBER_ORIGINAL_BLADE_REPLACEMENT',
      playerId: P1,
      memberCardId: kosuzu.instanceId,
      abilityId: 'test:later-fixed-blade',
      sourceCardId: twelve.instanceId,
      count: 4,
    });
    expect(getMemberOriginalBladeCount(fixedLater, P1, kosuzu.instanceId)).toBe(4);
    expect(getMemberEffectiveBladeCount(fixedLater, P1, kosuzu.instanceId)).toBe(6);
    const fellBelowThreshold = addLiveModifier(boosted, {
      kind: 'MEMBER_COST_SET',
      playerId: P1,
      memberCardId: twelve.instanceId,
      setTo: 12,
    });
    expect(getMemberOriginalBladeCount(fellBelowThreshold, P1, kosuzu.instanceId)).toBe(1);
    expect(getMemberEffectiveBladeCount(fellBelowThreshold, P1, kosuzu.instanceId)).toBe(3);
    expect(getCardAbilityDefinitionsForCardCode('PL!HS-PR-044-UNSEEN')).toContainEqual(
      expect.objectContaining({
        abilityId: KOSUZU,
        queued: false,
        effectText:
          '【常时】只要自己的舞台上存在费用大于等于１３的成员，此成员原本持有的[ブレード]的数量变为３。',
      })
    );
  });
});

describe('PL!S-pb2-021 费用5「松浦果南」', () => {
  it('applies its continuous bonus to effective green Hearts, including another continuous member bonus', () => {
    const kanan = fixture('PL!S-pb2-021', 'kanan');
    const other = member('other-azalea', {
      unitName: 'AZALEA',
      hearts: [createHeartIcon(GREEN, 7)],
    });
    const hanamaru = member('existing-continuous-source', {
      cardCode: 'PL!S-bp7-016-N',
      unitName: 'AZALEA',
      hearts: [createHeartIcon(GREEN, 1)],
    });
    const opponent = member(
      'opponent-azalea',
      { unitName: 'AZALEA', hearts: [createHeartIcon(GREEN, 10)] },
      P2
    );
    let game = stage(
      stage(stage(gameWith(kanan, other, hanamaru, opponent), kanan), other, LEFT),
      opponent
    );
    expect(getMemberEffectiveBladeCount(game, P1, kanan.instanceId)).toBe(0);
    game = stage(game, hanamaru, RIGHT, OrientationState.WAITING);
    expect(getMemberOriginalBladeCount(game, P1, kanan.instanceId)).toBe(0);
    expect(getMemberEffectiveBladeCount(game, P1, kanan.instanceId)).toBe(2);
    expect(collectLiveModifiers(game)).toContainEqual(
      expect.objectContaining({
        abilityId: KANAN_CONTINUOUS,
        target: 'SOURCE_MEMBER',
        sourceCardId: kanan.instanceId,
        countDelta: 2,
      })
    );
    const left = moveCardUniversal(
      game,
      P1,
      other.instanceId,
      ZoneType.MEMBER_SLOT,
      ZoneType.WAITING_ROOM,
      { sourceSlot: LEFT }
    );
    expect(getMemberEffectiveBladeCount(left, P1, kanan.instanceId)).toBe(0);
  });

  it('pays an exact private discard once, sets only original Hearts green, and immediately enables the continuous bonus', () => {
    const kanan = fixture('PL!S-pb2-021', 'kanan');
    const other = member('azalea', { unitName: 'AZALEA', hearts: [createHeartIcon(GREEN, 7)] });
    const discards = [member('discard'), member('extra-hand')];
    let game = stage(stage(gameWith(kanan, other, ...discards), kanan), other, LEFT);
    game = updatePlayer(game, P1, (player) => ({
      ...player,
      hand: { ...player.hand, cardIds: discards.map(({ instanceId }) => instanceId) },
    }));
    game = addLiveModifier(game, {
      kind: 'HEART',
      target: 'TARGET_MEMBER',
      playerId: P1,
      sourceCardId: other.instanceId,
      targetMemberCardId: kanan.instanceId,
      hearts: [createHeartIcon(BLUE, 1)],
    });
    const session = sessionFor(game);
    const activate = createActivateAbilityCommand(P1, kanan.instanceId, KANAN_ACTIVATED);
    expect(session.executeCommand(activate).success).toBe(true);
    let selecting = session.state!.activeEffect!;
    expect(selecting).toMatchObject({
      selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
      effectText:
        '【起动】【１回合１次】将１张手牌放置入休息室：LIVE结束时为止，此成员原本持有的HEART全部变为[緑ハート]。',
      confirmSelectionLabel: '放置入休息室',
    });
    expect(
      session.executeCommand(createConfirmEffectStepCommand(P1, selecting.id, 'forged')).success
    ).toBe(false);
    expect(
      session.executeCommand(createConfirmEffectStepCommand(P1, selecting.id, null)).success
    ).toBe(true);
    expect(session.executeCommand(activate).success).toBe(true);
    selecting = session.state!.activeEffect!;
    expect(
      session.executeCommand(
        createConfirmEffectStepCommand(P1, selecting.id, discards[0].instanceId)
      ).success
    ).toBe(true);
    const paid = session.state!;
    expect(events(paid, TriggerCondition.ON_ENTER_WAITING_ROOM)).toMatchObject([
      {
        cardInstanceIds: [discards[0].instanceId],
        fromZone: ZoneType.HAND,
      },
    ]);
    expect(getMemberOriginalHeartIcons(paid, P1, kanan.instanceId)).toEqual([
      createHeartIcon(GREEN, 3),
    ]);
    expect(getMemberEffectiveHeartIcons(paid, P1, kanan.instanceId)).toEqual([
      createHeartIcon(GREEN, 3),
      createHeartIcon(BLUE, 1),
    ]);
    expect(getMemberEffectiveBladeCount(paid, P1, kanan.instanceId)).toBe(2);
    expect(session.executeCommand(activate).success).toBe(false);
    expect(
      getMemberOriginalHeartIcons(
        removeStageMemberBoundLiveModifiers(paid, [kanan.instanceId]),
        P1,
        kanan.instanceId
      )
    ).toEqual(getMemberOriginalHeartIcons(game, P1, kanan.instanceId));
  });

  it('settles a saved discard prompt without payment when its stage object has re-entered', () => {
    const kanan = fixture('PL!S-pb2-021', 'kanan');
    const discard = member('discard');
    const game = updatePlayer(stage(gameWith(kanan, discard), kanan), P1, (player) => ({
      ...player,
      hand: { ...player.hand, cardIds: [discard.instanceId] },
    }));
    const session = sessionFor(game);
    const activate = createActivateAbilityCommand(P1, kanan.instanceId, KANAN_ACTIVATED);
    expect(session.executeCommand(activate).success).toBe(true);
    const selecting = session.state!.activeEffect!;
    const hand = moveCardUniversal(
      session.state!,
      P1,
      kanan.instanceId,
      ZoneType.MEMBER_SLOT,
      ZoneType.HAND,
      { sourceSlot: CENTER }
    );
    const returned = playMemberFromZoneToEmptySlot(hand, P1, {
      cardId: kanan.instanceId,
      sourceZone: ZoneType.HAND,
      toSlot: LEFT,
    })!;
    const resumed = sessionFor(returned.gameState);
    expect(
      resumed.executeCommand(createConfirmEffectStepCommand(P1, selecting.id, discard.instanceId))
        .success
    ).toBe(true);
    const done = resumed.state!;
    expect(done.activeEffect).toBeNull();
    expect(done.players[0].hand.cardIds).toEqual([discard.instanceId]);
    expect(events(done, TriggerCondition.ON_ENTER_WAITING_ROOM)).toEqual([]);
    expect(getMemberOriginalHeartIcons(done, P1, kanan.instanceId)).toEqual(
      getMemberOriginalHeartIcons(game, P1, kanan.instanceId)
    );
    expect(resumed.executeCommand(activate).success).toBe(true);
  });
});

describe('PL!S-pb2-022 费用2「黑泽黛雅」', () => {
  it('pays her own departure first, then can recover that card through Ruby’s exact same ability', () => {
    const dia = fixture('PL!S-pb2-022', 'dia');
    const session = sessionFor(stage(gameWith(dia), dia, CENTER, OrientationState.WAITING));
    expect(
      session.executeCommand(createActivateAbilityCommand(P1, dia.instanceId, DIA)).success
    ).toBe(true);
    const selecting = session.state!.activeEffect!;
    expect(selecting).toMatchObject({
      abilityId: DIA,
      effectText: '【起动】将此成员从舞台放置入休息室：从自己的休息室将１张成员卡加入手牌。',
      selectableCardIds: [dia.instanceId],
      canSkipSelection: false,
    });
    expect(session.state?.players[0].memberSlots.slots[CENTER]).toBeNull();
    expect(events(session.state!, TriggerCondition.ON_LEAVE_STAGE)).toHaveLength(1);
    expect(events(session.state!, TriggerCondition.ON_ENTER_WAITING_ROOM)).toHaveLength(1);
    expect(
      session.executeCommand(createConfirmEffectStepCommand(P1, selecting.id, dia.instanceId))
        .success
    ).toBe(true);
    expect(session.state?.activeEffect?.stepId).toBe(PUBLIC_CARD_SELECTION_CONFIRMATION_STEP_ID);
    const restored = sessionFor(session.state!, () => 12_000);
    expect(
      restored.executeCommand(createAutoAdvancePublicCardSelectionCommand(P2, selecting.id, 12_000))
        .success
    ).toBe(true);
    expect(restored.state?.players[0].hand.cardIds).toEqual([dia.instanceId]);
    expect(events(restored.state!, TriggerCondition.ON_ENTER_HAND)).toHaveLength(1);
    expect(getCardAbilityDefinitionsForCardCode('PL!S-pb2-022-UNSEEN')).toContainEqual(
      expect.objectContaining({ abilityId: DIA, baseCardCodes: ['PL!S-cl1-009', 'PL!S-pb2-022'] })
    );
  });
});

describe('PL!S-pb2-014 费用5「渡边曜」', () => {
  it.each([true, false])(
    'uses another stage member and independently places each available top Energy, ownDeck=%s',
    (hasOwnDeck) => {
      const you = fixture('PL!S-pb2-014', 'you');
      const other = member('cyaron', { unitName: '「CYaRon！」' });
      const energy1 = energy('own-energy', P1);
      const energy2 = energy('opponent-energy', P2);
      let game = gameWith(you, other, energy1, energy2);
      for (const card of hasOwnDeck ? [energy1, energy2] : [energy2]) {
        game = updatePlayer(game, card.ownerId, (player) => ({
          ...player,
          energyDeck: { ...player.energyDeck, cardIds: [card.instanceId] },
        }));
      }
      const alone = resolvePendingCardEffects(enter(game, you)).gameState;
      expect(events(alone, TriggerCondition.ON_ENERGY_PLACED_BY_CARD_EFFECT)).toEqual([]);
      const queued = enter(stage(game, other, LEFT, OrientationState.WAITING), you);
      const left = moveCardUniversal(
        queued,
        P1,
        you.instanceId,
        ZoneType.MEMBER_SLOT,
        ZoneType.WAITING_ROOM,
        { sourceSlot: CENTER }
      );
      const done = resolvePendingCardEffects(left).gameState;
      expect(done.players[0].energyZone.cardIds).toEqual(hasOwnDeck ? [energy1.instanceId] : []);
      expect(done.players[1].energyZone.cardStates.get(energy2.instanceId)?.orientation).toBe(
        OrientationState.WAITING
      );
      expect(events(done, TriggerCondition.ON_ENERGY_PLACED_BY_CARD_EFFECT)).toMatchObject(
        (hasOwnDeck ? [energy1, energy2] : [energy2]).map((card) => ({
          targetPlayerId: card.ownerId,
          placedEnergyCardIds: [card.instanceId],
          orientation: OrientationState.WAITING,
          cause: { sourceCardId: you.instanceId, playerId: P1, abilityId: YOU },
        }))
      );
      expect(getStageMemberDelegatableOnEnterDefinitions(you.data.cardCode, CENTER)).toContainEqual(
        expect.objectContaining({ abilityId: YOU })
      );
    }
  );

  it('excludes its original stage object after slot movement and counts the same card after re-entry', () => {
    const you = fixture('PL!S-pb2-014', 'you');
    const top = energy('own-energy', P1);
    const game = updatePlayer(gameWith(you, top), P1, (player) => ({
      ...player,
      energyDeck: { ...player.energyDeck, cardIds: [top.instanceId] },
    }));
    const queued = enter(game, you);
    const switched = moveCardUniversal(
      queued,
      P1,
      you.instanceId,
      ZoneType.MEMBER_SLOT,
      ZoneType.MEMBER_SLOT,
      { sourceSlot: CENTER, targetSlot: LEFT }
    );
    expect(switched.players[0].memberSlots.slots[LEFT]).toBe(you.instanceId);
    expect(resolvePendingCardEffects(switched).gameState.players[0].energyZone.cardIds).toEqual([]);
    const hand = moveCardUniversal(
      queued,
      P1,
      you.instanceId,
      ZoneType.MEMBER_SLOT,
      ZoneType.HAND,
      {
        sourceSlot: CENTER,
      }
    );
    const returned = playMemberFromZoneToEmptySlot(hand, P1, {
      cardId: you.instanceId,
      sourceZone: ZoneType.HAND,
      toSlot: LEFT,
    })!;
    expect(
      resolvePendingCardEffects(returned.gameState).gameState.players[0].energyZone.cardIds
    ).toEqual([top.instanceId]);
  });
});

describe('PL!S-pb2-019 费用17「高海千歌」', () => {
  it.each([false, true])(
    'draws through refresh and rewards only the original stage object, reentered=%s',
    (reentered) => {
      const chika = fixture('PL!S-pb2-019', 'chika');
      const top = member('opponent-top', {}, P2);
      const next = member('opponent-refresh', {}, P2);
      const game = updatePlayer(gameWith(chika, top, next), P2, (player) => ({
        ...player,
        mainDeck: { ...player.mainDeck, cardIds: [top.instanceId] },
        waitingRoom: { ...player.waitingRoom, cardIds: [next.instanceId] },
      }));
      let queued = enter(game, chika);
      if (reentered) {
        const left = moveCardUniversal(
          queued,
          P1,
          chika.instanceId,
          ZoneType.MEMBER_SLOT,
          ZoneType.WAITING_ROOM,
          { sourceSlot: CENTER }
        );
        const hand = moveCardUniversal(
          left,
          P1,
          chika.instanceId,
          ZoneType.WAITING_ROOM,
          ZoneType.HAND
        );
        queued = playMemberFromZoneToEmptySlot(hand, P1, {
          cardId: chika.instanceId,
          sourceZone: ZoneType.HAND,
          toSlot: CENTER,
        })!.gameState;
      }
      const done = resolvePendingCardEffects(queued).gameState;
      expect(done.players[1].hand.cardIds).toEqual([top.instanceId, next.instanceId]);
      expect(
        getMemberEffectiveHeartIcons(done, P1, chika.instanceId)
          .filter((heart) => heart.color === RED)
          .reduce((total, heart) => total + heart.count, 0)
      ).toBe(reentered ? 3 : 6);
      expect(done.pendingAbilities).toEqual([]);
      expect(
        done.actionHistory.filter(
          ({ type, payload }) =>
            type === 'RESOLVE_ABILITY' &&
            payload.abilityId === CHIKA &&
            payload.step === 'OPPONENT_DRAW_TWO_GAIN_RED_HEARTS'
        )
      ).toHaveLength(1);
    }
  );
});

describe('费用15「渡边曜」 delegating the new ON_ENTER abilities', () => {
  it.each([
    ['PL!S-pb2-014', YOU],
    ['PL!S-pb2-019', CHIKA],
  ])(
    'settles %s using its original stage source without emitting a synthetic entry',
    (base, abilityId) => {
      const you = createCardInstance(getNovember20MemberData('PL!S-bp7-005-SEC'), P1, 'delegate');
      const target = fixture(base, 'target');
      const discards = [live('discard-first'), live('discard-second')];
      const topOwn = energy('own-energy', P1);
      const topOpponent = energy('opponent-energy', P2);
      const opponentDraw = [member('first-draw', {}, P2), member('second-draw', {}, P2)];
      let game = stage(
        stage(gameWith(you, target, ...discards, topOwn, topOpponent, ...opponentDraw), you),
        target,
        LEFT
      );
      game = updatePlayer(game, P1, (player) => ({
        ...player,
        hand: { ...player.hand, cardIds: discards.map(({ instanceId }) => instanceId) },
        energyDeck: { ...player.energyDeck, cardIds: [topOwn.instanceId] },
      }));
      game = updatePlayer(game, P2, (player) => ({
        ...player,
        mainDeck: { ...player.mainDeck, cardIds: opponentDraw.map(({ instanceId }) => instanceId) },
        energyDeck: { ...player.energyDeck, cardIds: [topOpponent.instanceId] },
      }));
      const session = sessionFor(game);
      expect(
        session.executeCommand(createActivateAbilityCommand(P1, you.instanceId, DELEGATING_YOU))
          .success
      ).toBe(true);
      expect(
        session.executeCommand(
          createConfirmEffectStepCommand(
            P1,
            session.state!.activeEffect!.id,
            undefined,
            undefined,
            undefined,
            undefined,
            discards.map(({ instanceId }) => instanceId)
          )
        ).success
      ).toBe(true);
      expect(
        session.executeCommand(
          createConfirmEffectStepCommand(P1, session.state!.activeEffect!.id, target.instanceId)
        ).success
      ).toBe(true);
      expect(
        session.executeCommand(
          createConfirmEffectStepCommand(
            P1,
            session.state!.activeEffect!.id,
            undefined,
            undefined,
            undefined,
            'target-first'
          )
        ).success
      ).toBe(true);
      const done = session.state!;
      expect(done.pendingAbilities).toEqual([]);
      expect(done.delegatedAbilitySequence).toBeNull();
      expect(events(done, TriggerCondition.ON_ENTER_STAGE)).toEqual([]);
      expect(done.actionHistory).toContainEqual(
        expect.objectContaining({
          type: 'RESOLVE_ABILITY',
          payload: expect.objectContaining({ abilityId, sourceCardId: target.instanceId }),
        })
      );
      if (abilityId === YOU) {
        expect(events(done, TriggerCondition.ON_ENERGY_PLACED_BY_CARD_EFFECT)).toMatchObject(
          [topOwn, topOpponent].map((card) => ({
            targetPlayerId: card.ownerId,
            placedEnergyCardIds: [card.instanceId],
            orientation: OrientationState.WAITING,
            cause: { sourceCardId: target.instanceId, playerId: P1, abilityId },
          }))
        );
      } else {
        expect(done.players[1].hand.cardIds).toEqual(
          opponentDraw.map(({ instanceId }) => instanceId)
        );
        expect(getMemberEffectiveHeartIcons(done, P1, target.instanceId)).toContainEqual(
          createHeartIcon(RED, 3)
        );
        expect(getMemberEffectiveHeartIcons(done, P1, you.instanceId)).not.toContainEqual(
          createHeartIcon(RED, 3)
        );
      }
    }
  );
});

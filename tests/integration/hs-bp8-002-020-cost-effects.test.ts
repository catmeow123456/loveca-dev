import { describe, expect, it } from 'vitest';
import { GameService } from '../../src/application/game-service';
import { createGameSession } from '../../src/application/game-session';
import { createConfirmEffectStepCommand } from '../../src/application/game-commands';
import { ABILITY_ORDER_SELECTION_ID } from '../../src/application/card-effect-runner';
import {
  HS_BP8_002_CONTINUOUS_COST_PER_FIVE_GAIN_BLADE_ABILITY_ID as BLADE,
  HS_BP8_002_LIVE_START_DISCARD_GAIN_COST_ACTIVATE_DRAW_ABILITY_ID as SAYAKA,
  HS_BP8_020_LIVE_START_WAIT_TWO_REDUCE_REQUIREMENT_SKIP_ACTIVE_ABILITY_ID as WAIT,
  HS_BP8_020_LIVE_START_TARGET_DOLLCHESTRA_GAIN_COST_SCORE_ABILITY_ID as COST,
  HS_PB1_028_LIVE_START_ACTIVATE_DOLLCHESTRA_MEMBER_LIVE_START_ABILITY_ID as COMPASS,
  HS_PB1_003_AUTO_HAND_TO_WAITING_GAIN_HEART_BLADE_ABILITY_ID as HAND_WATCHER,
  PL_PR_023_AUTO_TURN_THREE_MEMBER_WAITED_GAIN_BLADE_ABILITY_ID as WAIT_WATCHER,
} from '../../src/application/card-effects/ability-ids';
import { getCardAbilityDefinitionsForCardCode } from '../../src/application/card-effects/definitions/lookup';
import {
  CardAbilityCategory,
  CardAbilitySourceZone,
} from '../../src/application/card-effects/ability-definition-types';
import {
  createCardInstance,
  createHeartRequirement,
  type MemberCardData,
  type LiveCardData,
} from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  emitGameEvent,
  type GameState,
} from '../../src/domain/entities/game';
import {
  placeCardInSlot,
  addCardToStatefulZone,
  removeCardFromSlot,
} from '../../src/domain/entities/zone';
import {
  createEnterStageEvent,
  createEnterLiveZoneEvent,
  createLiveStartEvent,
} from '../../src/domain/events/game-events';
import {
  addMemberCostLiveModifierForMember,
  addMemberCostSetLiveModifierForMember,
  getMemberEffectiveBladeCount,
  getLiveCardScoreModifier,
  getLiveCardRequirementModifiers,
} from '../../src/domain/rules/live-modifiers';
import { getMemberEffectiveCost } from '../../src/domain/rules/member-effective-cost';
import { addMemberEffectActivationProhibitionUntilTurnEnd } from '../../src/domain/rules/member-effect-activation-prohibitions';
import {
  CardType,
  FaceState,
  GamePhase,
  HeartColor,
  OrientationState,
  SlotPosition,
  SubPhase,
  TriggerCondition,
  ZoneType,
} from '../../src/shared/types/enums';

const P1 = 'p1',
  P2 = 'p2';
const SAYAKA_CONTINUOUS_TEXT = '【常时】此成员的费用每有5，获得[ブレード]。';
const SAYAKA_TEXT =
  '【LIVE开始时】可以将１张手牌放置入休息室：LIVE结束时为止，此成员的费用＋５。此后，此成员的费用大于等于２０的场合，将此成员变为活跃状态，抽1张卡。';
const ICY_WAIT_TEXT =
  '【LIVE开始时】可以将２名成员变为待机状态：此卡的必要HEART减少[無ハート][無ハート][無ハート]。因此变为待机状态的成员，在下个活跃阶段不会变为活跃状态。';
const ICY_COST_TEXT =
  '【LIVE开始时】LIVE结束时为止，１名『DOLLCHESTRA』的成员的费用＋５。此后，存在于自己的舞台的『莲之空』的成员的费用合计大于等于３０的场合，此卡的分数＋１。';
const SLOTS = [SlotPosition.LEFT, SlotPosition.CENTER, SlotPosition.RIGHT];

function member(
  code: string,
  cost: number,
  unit = 'DOLLCHESTRA',
  group = '蓮ノ空'
): MemberCardData {
  return {
    cardCode: code,
    name: code,
    cardType: CardType.MEMBER,
    cost,
    blade: 0,
    hearts: [],
    unitName: unit,
    groupNames: [group],
  };
}
function live(code: string): LiveCardData {
  return {
    cardCode: code,
    name: code,
    cardType: CardType.LIVE,
    score: 5,
    unitName: 'DOLLCHESTRA',
    requirements: createHeartRequirement({ [HeartColor.BLUE]: 2, [HeartColor.RAINBOW]: 5 }),
  };
}
function setup(
  options: {
    sayaka?: boolean;
    icy?: boolean;
    compass?: boolean;
    costs?: readonly number[];
    units?: readonly string[];
    orientations?: readonly OrientationState[];
    handCount?: number;
    rarity?: string;
    group?: string;
  } = {}
) {
  const costs = options.costs ?? [11];
  const members = costs.map((cost, index) =>
    createCardInstance(
      member(
        index === 0 && options.sayaka
          ? `PL!HS-bp8-002-${options.rarity ?? 'P'}`
          : `MEMBER-${index}`,
        cost,
        options.units?.[index] ?? 'DOLLCHESTRA',
        options.group ?? '蓮ノ空'
      ),
      P1,
      `member-${index}`
    )
  );
  const icy = createCardInstance(live(`PL!HS-bp8-020-${options.rarity ?? 'L'}`), P1, 'icy');
  const compass = createCardInstance(live('PL!HS-pb1-028-L'), P1, 'compass');
  const otherLive = createCardInstance(live('OTHER-LIVE'), P1, 'other-live');
  const hand = Array.from({ length: options.handCount ?? 2 }, (_, i) =>
    createCardInstance(member(`HAND-${i}`, 1), P1, `hand-${i}`)
  );
  const deck = Array.from({ length: 3 }, (_, i) =>
    createCardInstance(member(`DECK-${i}`, 1), P1, `deck-${i}`)
  );
  let game = registerCards(createGameState('bp8-cost-effects', P1, 'P1', P2, 'P2'), [
    ...members,
    icy,
    compass,
    otherLive,
    ...hand,
    ...deck,
  ]);
  members.forEach((card, index) => {
    game = updatePlayer(game, P1, (p) => ({
      ...p,
      memberSlots: placeCardInSlot(p.memberSlots, SLOTS[index]!, card.instanceId, {
        face: FaceState.FACE_UP,
        orientation: options.orientations?.[index] ?? OrientationState.ACTIVE,
      }),
    }));
    game = emitGameEvent(
      game,
      createEnterStageEvent(card.instanceId, ZoneType.HAND, SLOTS[index]!, P1, P1)
    );
  });
  const lives = [...(options.icy ? [icy] : []), ...(options.compass ? [compass] : []), otherLive];
  game = updatePlayer(game, P1, (p) => ({
    ...p,
    hand: { ...p.hand, cardIds: hand.map((c) => c.instanceId) },
    mainDeck: { ...p.mainDeck, cardIds: deck.map((c) => c.instanceId) },
    liveZone: lives.reduce(
      (zone, c) =>
        addCardToStatefulZone(zone, c.instanceId, {
          face: FaceState.FACE_UP,
          orientation: OrientationState.ACTIVE,
        }),
      p.liveZone
    ),
  }));
  lives.forEach((card) => {
    game = emitGameEvent(
      game,
      createEnterLiveZoneEvent(card.instanceId, ZoneType.HAND, P1, P1, FaceState.FACE_UP)
    );
  });
  game = {
    ...game,
    currentPhase: GamePhase.LIVE_RESULT_PHASE,
    currentSubPhase: SubPhase.RESULT_FIRST_SUCCESS_EFFECTS,
  };
  game = emitGameEvent(
    game,
    createLiveStartEvent(
      P1,
      lives.map((c) => c.instanceId)
    )
  );
  return { game, members, icy, compass, otherLive, hand, deck };
}
function sessionFor(game: GameState) {
  const session = createGameSession();
  session.createGame(game.id, P1, 'P1', P2, 'P2');
  (session as unknown as { authorityState: GameState }).authorityState = game;
  return session;
}
function start(game: GameState) {
  const result = new GameService().executeCheckTiming(game, [TriggerCondition.ON_LIVE_START]);
  expect(result.success, result.error).toBe(true);
  return sessionFor(result.gameState);
}
function submit(
  session: ReturnType<typeof sessionFor>,
  options: { card?: string; cards?: readonly string[]; option?: string } = {}
) {
  return session.executeCommand(
    createConfirmEffectStepCommand(
      P1,
      session.state!.activeEffect!.id,
      options.card,
      undefined,
      undefined,
      options.option,
      options.cards
    )
  );
}
function confirm(
  session: ReturnType<typeof sessionFor>,
  options: { card?: string; cards?: readonly string[]; option?: string } = {}
) {
  const result = submit(session, options);
  expect(result.success, result.error).toBe(true);
  return result;
}
function choose(session: ReturnType<typeof sessionFor>, abilityId: string) {
  if (session.state!.activeEffect?.abilityId === ABILITY_ORDER_SELECTION_ID) {
    const pending = session.state!.pendingAbilities.find((p) => p.abilityId === abilityId)!;
    expect(pending).toBeDefined();
    confirm(
      session,
      session.state!.activeEffect!.metadata?.usesAbilityOptions
        ? { option: pending.id }
        : { card: pending.sourceCardId }
    );
  }
  expect(session.state!.activeEffect?.abilityId).toBe(abilityId);
}
function replaceState(session: ReturnType<typeof sessionFor>, game: GameState) {
  (session as unknown as { authorityState: GameState }).authorityState = game;
}

describe('PL!HS-bp8-002 费用11「村野沙耶香」 / PL!HS-bp8-020 分数5「Icy」', () => {
  it.each(['P', 'R', 'P+', 'SEC', 'L'])(
    'registers exact independent paragraphs for all base-code rarities (%s)',
    (rare) => {
      const sayaka = getCardAbilityDefinitionsForCardCode(`PL!HS-bp8-002-${rare}`);
      expect(sayaka.map((d) => d.effectText)).toEqual([SAYAKA_CONTINUOUS_TEXT, SAYAKA_TEXT]);
      expect(sayaka.map((d) => d.abilityId)).toEqual([BLADE, SAYAKA]);
      expect(sayaka[0]).toMatchObject({
        category: CardAbilityCategory.CONTINUOUS,
        queued: false,
        implemented: true,
        baseCardCodes: ['PL!HS-bp8-002'],
      });
      expect(sayaka[1]).toMatchObject({
        category: CardAbilityCategory.LIVE_START,
        sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
        queued: true,
        implemented: true,
      });
      const icy = getCardAbilityDefinitionsForCardCode(`PL!HS-bp8-020-${rare}`);
      expect(icy.map((d) => d.effectText)).toEqual([ICY_WAIT_TEXT, ICY_COST_TEXT]);
      expect(icy.map((d) => d.abilityId)).toEqual([WAIT, COST]);
      icy.forEach((d) =>
        expect(d).toMatchObject({
          category: CardAbilityCategory.LIVE_START,
          sourceZone: CardAbilitySourceZone.LIVE_CARD,
          queued: true,
          baseCardCodes: ['PL!HS-bp8-020'],
        })
      );
    }
  );

  it.each([
    [11, 2],
    [14, 2],
    [15, 3],
    [19, 3],
    [20, 4],
    [-1, 0],
  ])('collects nonnegative BLADE from effective cost %i', (cost, blade) => {
    const scenario = setup({ sayaka: true, rarity: 'SEC' });
    const set = addMemberCostSetLiveModifierForMember(scenario.game, {
      playerId: P1,
      memberCardId: scenario.members[0]!.instanceId,
      sourceCardId: 'setter',
      abilityId: 'set',
      setTo: cost,
    })!;
    expect(getMemberEffectiveBladeCount(set.gameState, P1, scenario.members[0]!.instanceId)).toBe(
      blade
    );
    expect(set.gameState.liveResolution.liveModifiers).toEqual([set.modifier]);
    const offStage = updatePlayer(set.gameState, P1, (p) => ({
      ...p,
      memberSlots: removeCardFromSlot(p.memberSlots, SlotPosition.LEFT),
    }));
    expect(getMemberEffectiveBladeCount(offStage, P1, scenario.members[0]!.instanceId)).toBe(0);
  });

  it.each([14, 15])('pays discard, adds five, then checks the 20 threshold (before=%i)', (cost) => {
    const scenario = setup({
      sayaka: true,
      costs: [cost],
      orientations: [OrientationState.WAITING],
    });
    const session = start(scenario.game);
    expect(session.state!.activeEffect!.effectText).toBe(SAYAKA_TEXT);
    expect(session.state!.activeEffect).toMatchObject({
      confirmSelectionLabel: '放置入休息室',
      skipSelectionLabel: '不发动',
      selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
    });
    confirm(session, { card: scenario.hand[0]!.instanceId });
    expect(getMemberEffectiveCost(session.state!, P1, scenario.members[0]!.instanceId)).toBe(
      cost + 5
    );
    expect(session.state!.players[0]!.waitingRoom.cardIds).toContain(scenario.hand[0]!.instanceId);
    expect(session.state!.players[0]!.hand.cardIds).toEqual(
      cost === 15
        ? [scenario.hand[1]!.instanceId, scenario.deck[0]!.instanceId]
        : [scenario.hand[1]!.instanceId]
    );
    expect(
      session.state!.players[0]!.memberSlots.cardStates.get(scenario.members[0]!.instanceId)!
        .orientation
    ).toBe(cost === 15 ? OrientationState.ACTIVE : OrientationState.WAITING);
    expect(
      session.state!.actionHistory.filter(
        (a) => a.type === 'PAY_COST' && a.payload.abilityId === SAYAKA
      )
    ).toHaveLength(1);
    expect(
      session.state!.eventLog.filter(
        (r) => r.event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM
      )
    ).toHaveLength(1);
  });

  it.each(['already-active', 'activation-prohibited'])(
    'draws at 20 even when activation does not change orientation (%s)',
    (mode) => {
      const scenario = setup({
        sayaka: true,
        costs: [15],
        orientations: [
          mode === 'already-active' ? OrientationState.ACTIVE : OrientationState.WAITING,
        ],
      });
      const game =
        mode === 'activation-prohibited'
          ? addMemberEffectActivationProhibitionUntilTurnEnd(scenario.game, {
              affectedPlayerIds: [P1],
              sourceCardId: 'prohibition',
              abilityId: 'prohibition',
            })
          : scenario.game;
      const session = start(game);
      confirm(session, { card: scenario.hand[0]!.instanceId });
      expect(session.state!.players[0]!.hand.cardIds).toContain(scenario.deck[0]!.instanceId);
      expect(
        session.state!.eventLog.filter(
          (r) => r.event.eventType === TriggerCondition.ON_MEMBER_STATE_CHANGED
        )
      ).toEqual([]);
    }
  );

  it('preserves SET final override before or after a five-cost increase', () => {
    const scenario = setup({ sayaka: true });
    let game = addMemberCostSetLiveModifierForMember(scenario.game, {
      playerId: P1,
      memberCardId: scenario.members[0]!.instanceId,
      sourceCardId: 'setter',
      abilityId: 'set',
      setTo: 19,
    })!.gameState;
    const session = start(game);
    confirm(session, { card: scenario.hand[0]!.instanceId });
    expect(getMemberEffectiveCost(session.state!, P1, scenario.members[0]!.instanceId)).toBe(19);
    expect(getMemberEffectiveBladeCount(session.state!, P1, scenario.members[0]!.instanceId)).toBe(
      3
    );
    expect(session.state!.players[0]!.hand.cardIds).not.toContain(scenario.deck[0]!.instanceId);
    game = addMemberCostLiveModifierForMember(scenario.game, {
      playerId: P1,
      memberCardId: scenario.members[0]!.instanceId,
      sourceCardId: 'delta',
      abilityId: 'delta',
      countDelta: 5,
    })!.gameState;
    game = addMemberCostSetLiveModifierForMember(game, {
      playerId: P1,
      memberCardId: scenario.members[0]!.instanceId,
      sourceCardId: 'setter',
      abilityId: 'set',
      setTo: 19,
    })!.gameState;
    expect(getMemberEffectiveCost(game, P1, scenario.members[0]!.instanceId)).toBe(19);
  });

  it('supports a natural ability then COMPASS reactivation: 11 → 16 → 21', () => {
    const scenario = setup({
      sayaka: true,
      compass: true,
      orientations: [OrientationState.WAITING],
    });
    const session = start(scenario.game);
    choose(session, SAYAKA);
    confirm(session, { card: scenario.hand[0]!.instanceId });
    expect(getMemberEffectiveCost(session.state!, P1, scenario.members[0]!.instanceId)).toBe(16);
    expect(getMemberEffectiveBladeCount(session.state!, P1, scenario.members[0]!.instanceId)).toBe(
      3
    );
    choose(session, COMPASS);
    confirm(session, { card: scenario.members[0]!.instanceId });
    confirm(session, { option: SAYAKA });
    expect(session.state!.activeEffect!.abilityId).toBe(SAYAKA);
    confirm(session, { card: scenario.hand[1]!.instanceId });
    expect(getMemberEffectiveCost(session.state!, P1, scenario.members[0]!.instanceId)).toBe(21);
    expect(getMemberEffectiveBladeCount(session.state!, P1, scenario.members[0]!.instanceId)).toBe(
      4
    );
    expect(session.state!.players[0]!.hand.cardIds).toEqual([scenario.deck[0]!.instanceId]);
    expect(session.state!.pendingAbilities).toEqual([]);
    expect(session.state!.activeEffect).toBeNull();
  });

  it('allows decline and rejects foreign, stale and wrong-shaped discard without payment', () => {
    const scenario = setup({ sayaka: true });
    const session = start(scenario.game);
    const before = session.state!;
    expect(submit(session, { cards: [scenario.hand[0]!.instanceId] }).success).toBe(false);
    expect(submit(session, { option: 'forged' }).success).toBe(false);
    expect(submit(session, { card: 'forged' }).success).toBe(false);
    expect(session.state).toBe(before);
    replaceState(
      session,
      updatePlayer(before, P1, (p) => ({
        ...p,
        hand: { ...p.hand, cardIds: [scenario.hand[1]!.instanceId] },
      }))
    );
    const stale = session.state!;
    expect(submit(session, { card: scenario.hand[0]!.instanceId }).success).toBe(false);
    expect(session.state).toBe(stale);
    confirm(session);
    expect(session.state!.liveResolution.liveModifiers).toEqual([]);
    const noHand = start(setup({ sayaka: true, handCount: 0 }).game);
    expect(noHand.state!.activeEffect).toBeNull();
  });

  it('pays a legal hand cost but never grants self-effects to a reentered source', () => {
    const scenario = setup({ sayaka: true, costs: [20] });
    const session = start(scenario.game);
    replaceState(
      session,
      emitGameEvent(
        session.state!,
        createEnterStageEvent(
          scenario.members[0]!.instanceId,
          ZoneType.WAITING_ROOM,
          SlotPosition.LEFT,
          P1,
          P1
        )
      )
    );
    confirm(session, { card: scenario.hand[0]!.instanceId });
    expect(session.state!.players[0]!.waitingRoom.cardIds).toContain(scenario.hand[0]!.instanceId);
    expect(
      session.state!.actionHistory.filter(
        (a) => a.type === 'PAY_COST' && a.payload.abilityId === SAYAKA
      )
    ).toHaveLength(1);
    expect(session.state!.liveResolution.liveModifiers).toEqual([]);
    expect(session.state!.players[0]!.hand.cardIds).not.toContain(scenario.deck[0]!.instanceId);
  });

  it.each([WAIT, COST])(
    'keeps independent Icy pending and permits either ability first (%s)',
    (first) => {
      const scenario = setup({ icy: true, costs: [11, 14] });
      const session = start(scenario.game);
      expect(session.state!.pendingAbilities.map((p) => p.abilityId)).toEqual([WAIT, COST]);
      choose(session, first);
      if (first === WAIT) confirm(session, { cards: scenario.members.map((c) => c.instanceId) });
      else confirm(session, { card: scenario.members[0]!.instanceId });
      choose(session, first === WAIT ? COST : WAIT);
      if (first === WAIT) confirm(session, { card: scenario.members[0]!.instanceId });
      else confirm(session, { cards: scenario.members.map((c) => c.instanceId) });
      expect(getMemberEffectiveCost(session.state!, P1, scenario.members[0]!.instanceId)).toBe(16);
      expect(getLiveCardScoreModifier(session.state!.liveResolution, scenario.icy.instanceId)).toBe(
        1
      );
      expect(
        getLiveCardScoreModifier(session.state!.liveResolution, scenario.otherLive.instanceId)
      ).toBe(0);
      expect(
        getLiveCardRequirementModifiers(session.state!.liveResolution, scenario.icy.instanceId)
      ).toEqual([{ color: HeartColor.RAINBOW, countDelta: -3 }]);
      expect(
        getLiveCardRequirementModifiers(
          session.state!.liveResolution,
          scenario.otherLive.instanceId
        )
      ).toEqual([]);
      expect(session.state!.memberActivePhaseSkips.map((m) => m.memberCardId)).toEqual(
        scenario.members.map((c) => c.instanceId)
      );
    }
  );

  it('validates both members before WAIT payment and rejects wrong-shaped or stale targets atomically', () => {
    const scenario = setup({ icy: true, costs: [11, 14] });
    const session = start(scenario.game);
    choose(session, WAIT);
    expect(session.state!.activeEffect!.effectText).toBe(ICY_WAIT_TEXT);
    expect(session.state!.activeEffect).toMatchObject({
      minSelectableCards: 2,
      maxSelectableCards: 2,
      selectionLabel: '选择要变为待机状态的2名成员',
      confirmSelectionLabel: '变为待机状态',
      skipSelectionLabel: '不发动',
    });
    const before = session.state!;
    for (const cards of [
      [scenario.members[0]!.instanceId],
      [scenario.members[0]!.instanceId, scenario.members[0]!.instanceId],
      [scenario.members[0]!.instanceId, 'forged'],
    ]) {
      expect(submit(session, { cards }).success).toBe(false);
      expect(session.state).toBe(before);
    }
    expect(submit(session, { option: 'forged' }).success).toBe(false);
    replaceState(
      session,
      updatePlayer(before, P1, (p) => ({
        ...p,
        memberSlots: placeCardInSlot(
          p.memberSlots,
          SlotPosition.CENTER,
          scenario.members[1]!.instanceId,
          { face: FaceState.FACE_UP, orientation: OrientationState.WAITING }
        ),
      }))
    );
    const stale = session.state!;
    expect(submit(session, { cards: scenario.members.map((c) => c.instanceId) }).success).toBe(
      false
    );
    expect(session.state).toBe(stale);
    expect(session.state!.memberActivePhaseSkips).toEqual([]);
    expect(
      session.state!.eventLog.filter(
        (r) => r.event.eventType === TriggerCondition.ON_MEMBER_STATE_CHANGED
      )
    ).toEqual([]);
    confirm(session);
    choose(session, COST);
    expect(session.state!.liveResolution.liveModifiers).toEqual([]);
    expect(submit(session).success).toBe(false);
    expect(submit(session, { cards: [scenario.members[0]!.instanceId] }).success).toBe(false);
  });

  it.each([24, 25])('checks score after +5 using the total effective cost (before=%i)', (total) => {
    const scenario = setup({ icy: true, costs: [total], orientations: [OrientationState.WAITING] });
    const session = start(scenario.game);
    choose(session, COST);
    expect(session.state!.activeEffect!.effectText).toBe(ICY_COST_TEXT);
    confirm(session, { card: scenario.members[0]!.instanceId });
    expect(getLiveCardScoreModifier(session.state!.liveResolution, scenario.icy.instanceId)).toBe(
      total === 25 ? 1 : 0
    );
  });

  it.each([29, 30])(
    'still checks the 30 threshold when no DOLLCHESTRA target exists (%i)',
    (total) => {
      const scenario = setup({ icy: true, costs: [total], units: ['Cerise Bouquet'] });
      const session = start(scenario.game);
      choose(session, COST);
      if (session.state!.activeEffect?.metadata?.confirmOnlyPendingAbility) {
        expect(session.state!.activeEffect.effectText).toBe(ICY_COST_TEXT);
        expect(session.state!.activeEffect.stepText).toContain(`费用合计${total}`);
        confirm(session);
      }
      expect(getLiveCardScoreModifier(session.state!.liveResolution, scenario.icy.instanceId)).toBe(
        total === 30 ? 1 : 0
      );
      expect(
        session.state!.liveResolution.liveModifiers.some((m) => m.kind === 'MEMBER_COST')
      ).toBe(false);
    }
  );

  it.each([WAIT, COST])(
    'does not apply old Icy rewards to a new LIVE object but still pays/applies independent actions (%s)',
    (ability) => {
      const scenario = setup({ icy: true, costs: [15, 15] });
      const session = start(scenario.game);
      choose(session, ability);
      replaceState(
        session,
        emitGameEvent(
          session.state!,
          createEnterLiveZoneEvent(
            scenario.icy.instanceId,
            ZoneType.WAITING_ROOM,
            P1,
            P1,
            FaceState.FACE_UP
          )
        )
      );
      if (ability === WAIT) {
        confirm(session, { cards: scenario.members.map((c) => c.instanceId) });
        expect(session.state!.memberActivePhaseSkips).toHaveLength(2);
        expect(
          getLiveCardRequirementModifiers(session.state!.liveResolution, scenario.icy.instanceId)
        ).toEqual([]);
      } else {
        confirm(session, { card: scenario.members[0]!.instanceId });
        expect(getMemberEffectiveCost(session.state!, P1, scenario.members[0]!.instanceId)).toBe(
          20
        );
        expect(
          getLiveCardScoreModifier(session.state!.liveResolution, scenario.icy.instanceId)
        ).toBe(0);
      }
    }
  );

  it('consumes WAIT markers once in the owner active phase and then activates normally', () => {
    const scenario = setup({ icy: true, costs: [11, 14] });
    const session = start(scenario.game);
    choose(session, WAIT);
    confirm(session, { cards: scenario.members.map((c) => c.instanceId) });
    choose(session, COST);
    confirm(session, { card: scenario.members[0]!.instanceId });
    const service = new GameService();
    const next = service.advancePhase({
      ...session.state!,
      currentPhase: GamePhase.LIVE_RESULT_PHASE,
      currentSubPhase: SubPhase.NONE,
      activePlayerIndex: 0,
    });
    expect(next.success, next.error).toBe(true);
    expect(next.gameState.memberActivePhaseSkips).toEqual([]);
    scenario.members.forEach((c) =>
      expect(next.gameState.players[0]!.memberSlots.cardStates.get(c.instanceId)!.orientation).toBe(
        OrientationState.WAITING
      )
    );
    const following = service.advancePhase({
      ...next.gameState,
      currentPhase: GamePhase.LIVE_RESULT_PHASE,
      currentSubPhase: SubPhase.NONE,
      activePlayerIndex: 0,
    });
    expect(following.success).toBe(true);
    scenario.members.forEach((c) =>
      expect(
        following.gameState.players[0]!.memberSlots.cardStates.get(c.instanceId)!.orientation
      ).toBe(OrientationState.ACTIVE)
    );
  });

  it('completes discard, cost, activation and draw before the new hand-to-waiting AUTO resolves', () => {
    const scenario = setup({ sayaka: true, costs: [15], orientations: [OrientationState.WAITING] });
    const watcher = createCardInstance(member('PL!HS-pb1-003-R', 1), P1, 'hand-watcher');
    let game = registerCards(scenario.game, [watcher]);
    game = updatePlayer(game, P1, (p) => ({
      ...p,
      memberSlots: placeCardInSlot(p.memberSlots, SlotPosition.CENTER, watcher.instanceId),
    }));
    const session = start(game);
    const pendingId = session.state!.activeEffect!.id;
    confirm(session, { card: scenario.hand[0]!.instanceId });
    const ownFinish = session.state!.actionHistory.findIndex(
      (a) =>
        a.payload.abilityId === SAYAKA &&
        a.payload.step === 'DISCARD_GAIN_COST_CONDITIONAL_ACTIVATE_DRAW'
    );
    expect(ownFinish).toBeGreaterThan(-1);
    expect(session.state!.players[0]!.hand.cardIds).toContain(scenario.deck[0]!.instanceId);
    expect(
      session.state!.players[0]!.memberSlots.cardStates.get(scenario.members[0]!.instanceId)!
        .orientation
    ).toBe(OrientationState.ACTIVE);
    expect(
      session.state!.actionHistory.filter(
        (a) => a.type === 'TRIGGER_ABILITY' && a.payload.abilityId === HAND_WATCHER
      )
    ).toHaveLength(1);
    expect(
      session
        .state!.actionHistory.slice(0, ownFinish)
        .some((a) => a.type === 'RESOLVE_ABILITY' && a.payload.abilityId === HAND_WATCHER)
    ).toBe(false);
    expect(
      session.state!.actionHistory.findIndex(
        (a) => a.type === 'RESOLVE_ABILITY' && a.payload.abilityId === HAND_WATCHER
      )
    ).toBeGreaterThan(ownFinish);
    const activation = session.state!.eventLog.find(
      (r) =>
        r.event.eventType === TriggerCondition.ON_MEMBER_STATE_CHANGED &&
        r.event.cardInstanceId === scenario.members[0]!.instanceId
    )!.event;
    expect(activation).toMatchObject({
      previousOrientation: OrientationState.WAITING,
      nextOrientation: OrientationState.ACTIVE,
      cause: {
        kind: 'CARD_EFFECT',
        playerId: P1,
        sourceCardId: scenario.members[0]!.instanceId,
        abilityId: SAYAKA,
        pendingAbilityId: pendingId,
      },
    });
  });

  it('commits both Icy state events before enqueueing one AUTO per actual waited member', () => {
    const scenario = setup({ icy: true, costs: [11, 14] });
    const watcher = createCardInstance(
      member('PL!-PR-023-PR', 1, 'other', 'other'),
      P1,
      'wait-watcher'
    );
    let game = registerCards(scenario.game, [watcher]);
    game = updatePlayer(game, P1, (p) => ({
      ...p,
      memberSlots: placeCardInSlot(p.memberSlots, SlotPosition.RIGHT, watcher.instanceId),
    }));
    const session = start(game);
    choose(session, WAIT);
    const pendingId = session.state!.activeEffect!.id;
    confirm(session, { cards: scenario.members.map((c) => c.instanceId) });
    const events = session
      .state!.eventLog.filter((r) => r.event.eventType === TriggerCondition.ON_MEMBER_STATE_CHANGED)
      .map((r) => r.event);
    expect(events).toHaveLength(2);
    events.forEach((event, index) =>
      expect(event).toMatchObject({
        cardInstanceId: scenario.members[index]!.instanceId,
        controllerId: P1,
        previousOrientation: OrientationState.ACTIVE,
        nextOrientation: OrientationState.WAITING,
        cause: {
          kind: 'CARD_EFFECT',
          playerId: P1,
          sourceCardId: scenario.icy.instanceId,
          abilityId: WAIT,
          pendingAbilityId: pendingId,
        },
      })
    );
    const auto = session.state!.pendingAbilities.filter((p) => p.abilityId === WAIT_WATCHER);
    expect(auto).toHaveLength(2);
    expect(auto.map((p) => p.eventIds)).toEqual(events.map((event) => [event.eventId]));
    expect(
      session.state!.actionHistory.filter(
        (a) => a.type === 'TRIGGER_ABILITY' && a.payload.abilityId === WAIT_WATCHER
      )
    ).toHaveLength(2);
    expect(
      session.state!.actionHistory.some(
        (a) => a.type === 'RESOLVE_ABILITY' && a.payload.abilityId === WAIT_WATCHER
      )
    ).toBe(false);
    expect(
      session.state!.actionHistory.some(
        (a) => a.payload.step === 'WAIT_TWO_REDUCE_REQUIREMENT_SKIP_NEXT_ACTIVE'
      )
    ).toBe(true);
    choose(session, COST);
    confirm(session, { card: scenario.members[0]!.instanceId });
    expect(
      session.state!.pendingAbilities.filter((p) => p.abilityId === WAIT_WATCHER)
    ).toHaveLength(2);
  });
});

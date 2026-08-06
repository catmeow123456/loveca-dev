import { describe, expect, it } from 'vitest';
import {
  PR_WAIT_SELF_DISCARD_DRAW_ONE_ABILITY_ID,
  SP_BP1_003_ACTIVATED_REVEAL_HAND_MEMBERS_COST_TOTAL_GAIN_SCORE_ABILITY_ID,
  SP_BP1_009_ACTIVATED_PAY_ONE_ENERGY_DRAW_ONE_DISCARD_ONE_ABILITY_ID,
  SP_BP1_010_ACTIVATED_PAY_TWO_ENERGY_DISCARD_LOOK_TOP_FIVE_LIELLA_ABILITY_ID,
  SP_BP2_006_ACTIVATED_DISCARD_LOW_COST_LIELLA_MEMBER_ACTIVATE_ON_ENTER_ABILITY_ID,
  SP_BP2_008_ACTIVATED_PAY_ENERGY_SELF_POSITION_CHANGE_ABILITY_ID,
  SP_BP4_010_ACTIVATED_PAY_ENERGY_WAIT_SELF_PLACE_WAITING_ENERGY_ABILITY_ID,
  SP_BP5_001_ACTIVATED_WAIT_SELF_OR_DISCARD_ACTIVATE_ENERGY_ABILITY_ID,
  SP_BP5_005_ACTIVATED_MILL_THREE_GAIN_BLADE_BY_LIELLA_MEMBER_ABILITY_ID,
  SP_BP5_006_ACTIVATED_MILL_THREE_SELF_POSITION_CHANGE_ABILITY_ID,
  SP_BP5_020_ACTIVATED_PAY_TWO_ENERGY_DRAW_ONE_ABILITY_ID,
  SP_BP7_003_ACTIVATED_REVEAL_COST_TEN_OR_TWENTY_MEMBER_STACK_DRAW_TWO_ABILITY_ID,
  SP_BP7_008_ACTIVATED_WAIT_SELF_DRAW_ONE_ABILITY_ID,
  SP_BP7_010_ACTIVATED_SELF_SACRIFICE_RETURN_ENERGY_RECOVER_CARD_ABILITY_ID,
  SP_BP7_022_ACTIVATED_RETURN_ENERGY_SELF_POSITION_CHANGE_ABILITY_ID,
  SP_SD1_005_ACTIVATED_PAY_THREE_ENERGY_RECOVER_LIVE_ABILITY_ID,
  SP_SD1_011_ACTIVATED_PAY_TWO_ENERGY_PLACE_WAITING_ENERGY_ABILITY_ID,
  SP_SD2_002_ACTIVATED_PAY_TWO_ENERGY_SELF_POSITION_CHANGE_ABILITY_ID,
  SP_SD2_006_ACTIVATED_PAY_TWO_ENERGY_DISCARD_RECOVER_LIELLA_LIVE_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import {
  createActivateAbilityCommand,
  createConfirmEffectStepCommand,
} from '../../src/application/game-commands';
import { createGameSession, type GameSession } from '../../src/application/game-session';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
  type CardInstance,
  type EnergyCardData,
  type LiveCardData,
  type MemberCardData,
} from '../../src/domain/entities/card';
import { registerCards, updatePlayer, type GameState } from '../../src/domain/entities/game';
import {
  addCardToStatefulZone,
  addMemberBelowMember,
  placeCardInSlot,
  removeCardFromSlot,
} from '../../src/domain/entities/zone';
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
import { confirmPublicSelectionIfNeeded } from '../helpers/public-card-selection-confirmation';

const P1 = 'player1';
const P2 = 'player2';
const REN_CODE = 'PL!SP-pb2-005-R';

interface AbilityCase {
  readonly label: string;
  readonly directCode: string;
  readonly abilityId: string;
}

const CASES = [
  {
    label: 'PL!SP-bp1-003 费用10「嵐 千砂都」',
    directCode: 'PL!SP-bp1-003-P',
    abilityId: SP_BP1_003_ACTIVATED_REVEAL_HAND_MEMBERS_COST_TOTAL_GAIN_SCORE_ABILITY_ID,
  },
  {
    label: 'PL!SP-bp1-009 费用9「鬼塚夏美」',
    directCode: 'PL!SP-bp1-009-P',
    abilityId: SP_BP1_009_ACTIVATED_PAY_ONE_ENERGY_DRAW_ONE_DISCARD_ONE_ABILITY_ID,
  },
  {
    label: 'PL!SP-bp1-010 费用11「ウィーン・マルガレーテ」',
    directCode: 'PL!SP-bp1-010-R',
    abilityId: SP_BP1_010_ACTIVATED_PAY_TWO_ENERGY_DISCARD_LOOK_TOP_FIVE_LIELLA_ABILITY_ID,
  },
  {
    label: 'PL!SP-bp2-006 费用10「桜小路きな子」',
    directCode: 'PL!SP-bp2-006-R＋',
    abilityId: SP_BP2_006_ACTIVATED_DISCARD_LOW_COST_LIELLA_MEMBER_ACTIVATE_ON_ENTER_ABILITY_ID,
  },
  {
    label: 'PL!SP-bp2-008 费用9「若菜四季」',
    directCode: 'PL!SP-bp2-008-R',
    abilityId: SP_BP2_008_ACTIVATED_PAY_ENERGY_SELF_POSITION_CHANGE_ABILITY_ID,
  },
  {
    label: 'PL!SP-bp4-010 费用9「ウィーン・マルガレーテ」',
    directCode: 'PL!SP-bp4-010-R',
    abilityId: SP_BP4_010_ACTIVATED_PAY_ENERGY_WAIT_SELF_PLACE_WAITING_ENERGY_ABILITY_ID,
  },
  {
    label: 'PL!SP-bp5-001 费用10「澁谷かのん」',
    directCode: 'PL!SP-bp5-001-R＋',
    abilityId: SP_BP5_001_ACTIVATED_WAIT_SELF_OR_DISCARD_ACTIVATE_ENERGY_ABILITY_ID,
  },
  {
    label: 'PL!SP-bp5-005 费用11「葉月 恋」',
    directCode: 'PL!SP-bp5-005-R＋',
    abilityId: SP_BP5_005_ACTIVATED_MILL_THREE_GAIN_BLADE_BY_LIELLA_MEMBER_ABILITY_ID,
  },
  {
    label: 'PL!SP-bp5-006 费用11「桜小路きな子」',
    directCode: 'PL!SP-bp5-006-R',
    abilityId: SP_BP5_006_ACTIVATED_MILL_THREE_SELF_POSITION_CHANGE_ABILITY_ID,
  },
  {
    label: 'PL!SP-bp5-020 费用4「鬼塚夏美」',
    directCode: 'PL!SP-bp5-020-N',
    abilityId: SP_BP5_020_ACTIVATED_PAY_TWO_ENERGY_DRAW_ONE_ABILITY_ID,
  },
  {
    label: 'PL!SP-bp7-003 费用10「嵐 千砂都」',
    directCode: 'PL!SP-bp7-003-SEC',
    abilityId: SP_BP7_003_ACTIVATED_REVEAL_COST_TEN_OR_TWENTY_MEMBER_STACK_DRAW_TWO_ABILITY_ID,
  },
  {
    label: 'PL!SP-bp7-008 费用11「若菜四季」',
    directCode: 'PL!SP-bp7-008-P',
    abilityId: SP_BP7_008_ACTIVATED_WAIT_SELF_DRAW_ONE_ABILITY_ID,
  },
  {
    label: 'PL!SP-bp7-022 费用2「鬼塚冬毬」',
    directCode: 'PL!SP-bp7-022-N',
    abilityId: SP_BP7_022_ACTIVATED_RETURN_ENERGY_SELF_POSITION_CHANGE_ABILITY_ID,
  },
  {
    label: 'PL!SP-PR-017 费用4「ウィーン・マルガレーテ」',
    directCode: 'PL!SP-PR-017-PR',
    abilityId: PR_WAIT_SELF_DISCARD_DRAW_ONE_ABILITY_ID,
  },
  {
    label: 'PL!SP-sd1-005 费用9「葉月 恋」',
    directCode: 'PL!SP-sd1-005-SD',
    abilityId: SP_SD1_005_ACTIVATED_PAY_THREE_ENERGY_RECOVER_LIVE_ABILITY_ID,
  },
  {
    label: 'PL!SP-sd1-011 费用7「鬼塚冬毬」',
    directCode: 'PL!SP-sd1-011-SD',
    abilityId: SP_SD1_011_ACTIVATED_PAY_TWO_ENERGY_PLACE_WAITING_ENERGY_ABILITY_ID,
  },
  {
    label: 'PL!SP-sd2-002 费用13「唐 可可」',
    directCode: 'PL!SP-sd2-002-SD2',
    abilityId: SP_SD2_002_ACTIVATED_PAY_TWO_ENERGY_SELF_POSITION_CHANGE_ABILITY_ID,
  },
  {
    label: 'PL!SP-sd2-006 费用7「桜小路きな子」',
    directCode: 'PL!SP-sd2-006-SD2',
    abilityId: SP_SD2_006_ACTIVATED_PAY_TWO_ENERGY_DISCARD_RECOVER_LIELLA_LIVE_ABILITY_ID,
  },
] as const satisfies readonly AbilityCase[];
type SourceMode = 'DIRECT' | 'REN' | 'REN_WITHOUT_BELOW' | 'UNRELATED';

interface Scenario {
  readonly session: GameSession;
  readonly cardCase: AbilityCase;
  readonly sourceId: string;
  readonly grantedCardId: string | null;
  readonly costTenHandId: string;
  readonly discardHandId: string;
  readonly waitingLiveId: string;
  readonly energyIds: readonly string[];
  readonly mainDeckIds: readonly string[];
}

function member(
  cardCode: string,
  instanceId: string,
  options: { readonly name?: string; readonly cost?: number; readonly group?: string } = {}
): CardInstance<MemberCardData> {
  return createCardInstance(
    {
      cardCode,
      name: options.name ?? instanceId,
      groupNames: [options.group ?? 'Liella!'],
      unitName: options.group ?? 'Liella!',
      cardType: CardType.MEMBER,
      cost: options.cost ?? 4,
      blade: 1,
      hearts: [createHeartIcon(HeartColor.YELLOW, 1)],
    },
    P1,
    instanceId
  );
}

function live(cardCode: string, instanceId: string): CardInstance<LiveCardData> {
  return createCardInstance(
    {
      cardCode,
      name: instanceId,
      groupNames: ['Liella!'],
      unitName: 'Liella!',
      cardType: CardType.LIVE,
      score: 1,
      requirements: createHeartRequirement({ [HeartColor.YELLOW]: 1 }),
    },
    P1,
    instanceId
  );
}

function energy(index: number, prefix = 'energy'): CardInstance<EnergyCardData> {
  return createCardInstance(
    { cardCode: `ENERGY-${prefix}-${index}`, name: `Energy ${index}`, cardType: CardType.ENERGY },
    P1,
    `${prefix}-${index}`
  );
}

function setSessionState(session: GameSession, game: GameState): void {
  (session as unknown as { authorityState: GameState }).authorityState = game;
}

function setupScenario(cardCase: AbilityCase, sourceMode: SourceMode): Scenario {
  const session = createGameSession();
  session.createGame(`ren-granted:${cardCase.abilityId}:${sourceMode}`, P1, 'P1', P2, 'P2');

  const sourceCode =
    sourceMode === 'DIRECT'
      ? cardCase.directCode
      : sourceMode === 'UNRELATED'
        ? 'PL!SP-bp1-004-R'
        : REN_CODE;
  const source = member(sourceCode, `source:${sourceMode}`, {
    name: sourceCode === REN_CODE ? '葉月 恋' : sourceCode,
    cost: sourceCode === REN_CODE ? 20 : 10,
  });
  const grantedCard = member(cardCase.directCode, 'granted-card', { cost: 4 });
  const otherStage = member('PL!SP-test-stage-member', 'other-stage', { cost: 4 });
  const delegatedOnEnter = member('PL!SP-bp1-005-R', 'delegated-on-enter', { cost: 4 });
  const costTenHand = member('PL!SP-test-cost-10', 'cost-ten-hand', { cost: 10 });
  const discardHand = member('PL!SP-test-discard', 'discard-hand', { cost: 3 });
  const waitingLive = live('PL!SP-test-live', 'waiting-liella-live');
  const energies = Array.from({ length: 10 }, (_, index) => energy(index));
  const energyDeck = Array.from({ length: 4 }, (_, index) => energy(index, 'energy-deck'));
  const mainDeck = Array.from({ length: 12 }, (_, index) =>
    member(`PL!SP-test-main-${index}`, `main-${index}`, { cost: 2 })
  );

  let game = registerCards(session.state!, [
    source,
    grantedCard,
    otherStage,
    delegatedOnEnter,
    costTenHand,
    discardHand,
    waitingLive,
    ...energies,
    ...energyDeck,
    ...mainDeck,
  ]);
  game = updatePlayer(game, P1, (player) => {
    let memberSlots = placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    });
    memberSlots = placeCardInSlot(memberSlots, SlotPosition.LEFT, otherStage.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    });
    if (sourceMode === 'REN' || sourceMode === 'UNRELATED') {
      memberSlots = addMemberBelowMember(memberSlots, SlotPosition.CENTER, grantedCard.instanceId);
    }
    return {
      ...player,
      hand: {
        ...player.hand,
        cardIds: [delegatedOnEnter.instanceId, costTenHand.instanceId, discardHand.instanceId],
      },
      mainDeck: { ...player.mainDeck, cardIds: mainDeck.map((card) => card.instanceId) },
      waitingRoom: { ...player.waitingRoom, cardIds: [waitingLive.instanceId] },
      energyDeck: { ...player.energyDeck, cardIds: energyDeck.map((card) => card.instanceId) },
      energyZone: energies.reduce(
        (zone, card, index) =>
          addCardToStatefulZone(zone, card.instanceId, {
            orientation: index < 8 ? OrientationState.ACTIVE : OrientationState.WAITING,
            face: FaceState.FACE_UP,
          }),
        player.energyZone
      ),
      memberSlots,
    };
  });
  game = {
    ...game,
    currentPhase: GamePhase.MAIN_PHASE,
    currentSubPhase: SubPhase.NONE,
    currentTurnType: TurnType.NORMAL,
    activePlayerIndex: 0,
    waitingPlayerId: null,
  };
  setSessionState(session, game);

  return {
    session,
    cardCase,
    sourceId: source.instanceId,
    grantedCardId:
      sourceMode === 'REN' || sourceMode === 'UNRELATED' ? grantedCard.instanceId : null,
    costTenHandId: costTenHand.instanceId,
    discardHandId: discardHand.instanceId,
    waitingLiveId: waitingLive.instanceId,
    energyIds: energies.map((card) => card.instanceId),
    mainDeckIds: mainDeck.map((card) => card.instanceId),
  };
}

function activate(scenario: Scenario) {
  return scenario.session.executeCommand(
    createActivateAbilityCommand(P1, scenario.sourceId, scenario.cardCase.abilityId)
  );
}

function confirmCard(scenario: Scenario, selectedCardId: string) {
  return scenario.session.executeCommand(
    createConfirmEffectStepCommand(P1, scenario.session.state!.activeEffect!.id, selectedCardId)
  );
}

function confirmCards(scenario: Scenario, selectedCardIds: readonly string[]) {
  return scenario.session.executeCommand(
    createConfirmEffectStepCommand(
      P1,
      scenario.session.state!.activeEffect!.id,
      undefined,
      undefined,
      undefined,
      undefined,
      selectedCardIds
    )
  );
}

function confirmSlot(scenario: Scenario, selectedSlot: SlotPosition) {
  return scenario.session.executeCommand(
    createConfirmEffectStepCommand(
      P1,
      scenario.session.state!.activeEffect!.id,
      undefined,
      selectedSlot
    )
  );
}

function hasWorkflowEvidence(scenario: Scenario): boolean {
  const game = scenario.session.state!;
  return (
    game.activeEffect?.abilityId === scenario.cardCase.abilityId ||
    game.actionHistory.some(
      (action) =>
        action.payload.abilityId === scenario.cardCase.abilityId &&
        action.payload.sourceCardId === scenario.sourceId
    )
  );
}

describe('PL!SP-pb2-005 费用20、分数—「葉月 恋」获得下方 Liella! 成员起动能力的来源契约', () => {
  it.each(CASES)('$label：原卡直发与合法恋宿主都进入对应 production workflow', (cardCase) => {
    for (const sourceMode of ['DIRECT', 'REN'] as const) {
      const scenario = setupScenario(cardCase, sourceMode);
      const result = activate(scenario);
      expect(result.success, `${sourceMode}: ${result.error ?? ''}`).toBe(true);
      expect(hasWorkflowEvidence(scenario)).toBe(true);
    }
  });

  it.each(CASES)('$label：无对应下方成员或非恋成员不能借用 abilityId', (cardCase) => {
    for (const sourceMode of ['REN_WITHOUT_BELOW', 'UNRELATED'] as const) {
      const scenario = setupScenario(cardCase, sourceMode);
      const result = activate(scenario);
      expect(result.success, `${sourceMode} unexpectedly activated`).toBe(false);
      expect(scenario.session.state?.activeEffect).toBeNull();
      expect(hasWorkflowEvidence(scenario)).toBe(false);
    }
  });

  it('下方成员被移除后，恋立即失去对应起动能力', () => {
    const cardCase = CASES.find(
      (entry) => entry.abilityId === SP_BP5_020_ACTIVATED_PAY_TWO_ENERGY_DRAW_ONE_ABILITY_ID
    )!;
    const scenario = setupScenario(cardCase, 'REN');
    const state = updatePlayer(scenario.session.state!, P1, (player) => ({
      ...player,
      memberSlots: {
        ...player.memberSlots,
        memberBelow: {
          ...player.memberSlots.memberBelow,
          [SlotPosition.CENTER]: [],
        },
      },
    }));
    setSessionState(scenario.session, state);

    expect(activate(scenario).success).toBe(false);
    expect(hasWorkflowEvidence(scenario)).toBe(false);
  });
});

describe('PL!SP-pb2-005 恋宿主的多阶段复核与“此成员”实际作用对象', () => {
  it('bp1-003 在启动与公开确认阶段都保留宿主，并将 SCORE 绑定宿主', () => {
    const cardCase = CASES[0];
    const scenario = setupScenario(cardCase, 'REN');

    expect(activate(scenario).success).toBe(true);
    expect(scenario.session.state?.activeEffect).toMatchObject({
      abilityId: cardCase.abilityId,
      sourceCardId: scenario.sourceId,
      selectableCardIds: expect.arrayContaining([scenario.costTenHandId]),
    });
    expect(confirmCards(scenario, [scenario.costTenHandId]).success).toBe(true);
    expect(scenario.session.state?.activeEffect).toMatchObject({
      abilityId: cardCase.abilityId,
      sourceCardId: scenario.sourceId,
      revealedCardIds: [scenario.costTenHandId],
    });
    confirmPublicSelectionIfNeeded(scenario.session);

    expect(scenario.session.state?.activeEffect).toBeNull();
    expect(scenario.session.state?.players[0].hand.cardIds).toContain(scenario.costTenHandId);
    expect(scenario.session.state?.liveResolution.liveModifiers).toContainEqual(
      expect.objectContaining({
        kind: 'SCORE',
        sourceCardId: scenario.sourceId,
        targetMemberCardId: scenario.sourceId,
        abilityId: cardCase.abilityId,
      })
    );
  });

  it('sd2-006 在启动和支付确认阶段都接受宿主，费用与回收完整结算', () => {
    const cardCase = CASES.find(
      (entry) =>
        entry.abilityId ===
        SP_SD2_006_ACTIVATED_PAY_TWO_ENERGY_DISCARD_RECOVER_LIELLA_LIVE_ABILITY_ID
    )!;
    const scenario = setupScenario(cardCase, 'REN');

    expect(activate(scenario).success).toBe(true);
    expect(scenario.session.state?.activeEffect).toMatchObject({
      abilityId: cardCase.abilityId,
      sourceCardId: scenario.sourceId,
      selectableCardIds: expect.arrayContaining([scenario.discardHandId]),
    });
    expect(confirmCard(scenario, scenario.discardHandId).success).toBe(true);
    expect(scenario.session.state?.activeEffect).toMatchObject({
      abilityId: cardCase.abilityId,
      sourceCardId: scenario.sourceId,
      selectableCardIds: [scenario.waitingLiveId],
    });
    expect(confirmCard(scenario, scenario.waitingLiveId).success).toBe(true);
    confirmPublicSelectionIfNeeded(scenario.session);

    const player = scenario.session.state!.players[0];
    expect(player.hand.cardIds).toContain(scenario.waitingLiveId);
    expect(player.waitingRoom.cardIds).toContain(scenario.discardHandId);
    expect(player.memberSlots.slots[SlotPosition.CENTER]).toBe(scenario.sourceId);
    expect(player.memberSlots.memberBelow[SlotPosition.CENTER]).toContain(scenario.grantedCardId);
    expect(
      scenario.energyIds
        .slice(0, 2)
        .map((cardId) => player.energyZone.cardStates.get(cardId)?.orientation)
    ).toEqual([OrientationState.WAITING, OrientationState.WAITING]);
    expect(
      scenario.session.state?.actionHistory.find(
        (action) => action.type === 'PAY_COST' && action.payload.abilityId === cardCase.abilityId
      )?.payload.sourceCardId
    ).toBe(scenario.sourceId);
  });

  it('bp7-008 的 ACTIVE 门禁和待机费用检查、作用于恋宿主而非下方四季', () => {
    const cardCase = CASES.find(
      (entry) => entry.abilityId === SP_BP7_008_ACTIVATED_WAIT_SELF_DRAW_ONE_ABILITY_ID
    )!;
    const scenario = setupScenario(cardCase, 'REN');

    expect(activate(scenario).success).toBe(true);
    expect(
      scenario.session.state?.players[0].memberSlots.cardStates.get(scenario.sourceId)?.orientation
    ).toBe(OrientationState.WAITING);
    expect(
      scenario.session.state?.actionHistory.find(
        (action) => action.type === 'PAY_COST' && action.payload.abilityId === cardCase.abilityId
      )?.payload
    ).toMatchObject({ sourceCardId: scenario.sourceId, waitedMemberCardId: scenario.sourceId });

    const waitingHost = setupScenario(cardCase, 'REN');
    const waitingState = updatePlayer(waitingHost.session.state!, P1, (player) => ({
      ...player,
      memberSlots: {
        ...player.memberSlots,
        cardStates: new Map(player.memberSlots.cardStates).set(waitingHost.sourceId, {
          orientation: OrientationState.WAITING,
          face: FaceState.FACE_UP,
        }),
      },
    }));
    setSessionState(waitingHost.session, waitingState);
    expect(activate(waitingHost).success).toBe(false);
  });

  it('bp5-006 将恋宿主及其下方卡整体移动，而不是移动授予能力的きな子', () => {
    const cardCase = CASES.find(
      (entry) => entry.abilityId === SP_BP5_006_ACTIVATED_MILL_THREE_SELF_POSITION_CHANGE_ABILITY_ID
    )!;
    const scenario = setupScenario(cardCase, 'REN');

    expect(activate(scenario).success).toBe(true);
    expect(scenario.session.state?.activeEffect).toMatchObject({
      sourceCardId: scenario.sourceId,
      selectableSlots: expect.arrayContaining([SlotPosition.RIGHT]),
    });
    expect(confirmSlot(scenario, SlotPosition.RIGHT).success).toBe(true);

    const slots = scenario.session.state!.players[0].memberSlots;
    expect(slots.slots[SlotPosition.RIGHT]).toBe(scenario.sourceId);
    expect(slots.memberBelow[SlotPosition.RIGHT]).toContain(scenario.grantedCardId);
    expect(slots.slots[SlotPosition.CENTER]).toBeNull();
  });

  it('bp7-022 由恋宿主支付返回能量费用，并在后续步骤移动宿主及其下方卡', () => {
    const cardCase = CASES.find(
      (entry) =>
        entry.abilityId === SP_BP7_022_ACTIVATED_RETURN_ENERGY_SELF_POSITION_CHANGE_ABILITY_ID
    )!;
    const scenario = setupScenario(cardCase, 'REN');

    expect(activate(scenario).success).toBe(true);
    expect(scenario.session.state?.activeEffect).toMatchObject({
      abilityId: cardCase.abilityId,
      sourceCardId: scenario.sourceId,
      selectableSlots: expect.arrayContaining([SlotPosition.RIGHT]),
    });
    expect(scenario.session.state?.players[0].energyDeck.cardIds).toContain(scenario.energyIds[8]);
    expect(confirmSlot(scenario, SlotPosition.RIGHT).success).toBe(true);

    const slots = scenario.session.state!.players[0].memberSlots;
    expect(slots.slots[SlotPosition.RIGHT]).toBe(scenario.sourceId);
    expect(slots.memberBelow[SlotPosition.RIGHT]).toContain(scenario.grantedCardId);
    expect(slots.slots[SlotPosition.CENTER]).toBeNull();
    expect(
      scenario.session.state?.actionHistory.find(
        (action) => action.type === 'PAY_COST' && action.payload.abilityId === cardCase.abilityId
      )?.payload
    ).toMatchObject({
      sourceCardId: scenario.sourceId,
      returnedEnergyCardIds: [scenario.energyIds[8]],
    });
  });

  it('bp5-005 将按本次牌库成员数获得的 BLADE 绑定恋宿主', () => {
    const cardCase = CASES.find(
      (entry) =>
        entry.abilityId === SP_BP5_005_ACTIVATED_MILL_THREE_GAIN_BLADE_BY_LIELLA_MEMBER_ABILITY_ID
    )!;
    const scenario = setupScenario(cardCase, 'REN');

    expect(activate(scenario).success).toBe(true);
    expect(scenario.session.state?.players[0].waitingRoom.cardIds).toEqual(
      expect.arrayContaining(scenario.mainDeckIds.slice(0, 3))
    );
    expect(scenario.session.state?.liveResolution.liveModifiers).toContainEqual(
      expect.objectContaining({
        kind: 'BLADE',
        sourceCardId: scenario.sourceId,
        abilityId: cardCase.abilityId,
        countDelta: 3,
      })
    );
  });

  it('bp7-003 公开确认后把费用成员叠在恋宿主下方并由宿主抽2', () => {
    const cardCase = CASES.find(
      (entry) =>
        entry.abilityId ===
        SP_BP7_003_ACTIVATED_REVEAL_COST_TEN_OR_TWENTY_MEMBER_STACK_DRAW_TWO_ABILITY_ID
    )!;
    const scenario = setupScenario(cardCase, 'REN');
    const initialHandCount = scenario.session.state!.players[0].hand.cardIds.length;

    expect(activate(scenario).success).toBe(true);
    expect(confirmCard(scenario, scenario.costTenHandId).success).toBe(true);
    expect(scenario.session.state?.activeEffect).toMatchObject({
      sourceCardId: scenario.sourceId,
      revealedCardIds: [scenario.costTenHandId],
    });
    confirmPublicSelectionIfNeeded(scenario.session);

    const player = scenario.session.state!.players[0];
    expect(player.memberSlots.slots[SlotPosition.CENTER]).toBe(scenario.sourceId);
    expect(player.memberSlots.memberBelow[SlotPosition.CENTER]).toEqual(
      expect.arrayContaining([scenario.grantedCardId, scenario.costTenHandId])
    );
    expect(player.hand.cardIds).not.toContain(scenario.costTenHandId);
    expect(player.hand.cardIds).toHaveLength(initialHandCount + 1);
  });

  it('已兼容的 bp7-010 自送费用让恋宿主离场，而不是把下方授予卡当作来源', () => {
    const selfSacrificeCase: AbilityCase = {
      label: 'PL!SP-bp7-010 费用2「ウィーン・マルガレーテ」',
      directCode: 'PL!SP-bp7-010-SEC',
      abilityId: SP_BP7_010_ACTIVATED_SELF_SACRIFICE_RETURN_ENERGY_RECOVER_CARD_ABILITY_ID,
    };
    const scenario = setupScenario(selfSacrificeCase, 'REN');

    expect(activate(scenario).success).toBe(true);

    const player = scenario.session.state!.players[0];
    expect(player.memberSlots.slots[SlotPosition.CENTER]).toBeNull();
    expect(player.waitingRoom.cardIds).toEqual(
      expect.arrayContaining([scenario.sourceId, scenario.grantedCardId])
    );
    expect(scenario.session.state?.activeEffect).toMatchObject({
      abilityId: selfSacrificeCase.abilityId,
      sourceCardId: scenario.sourceId,
    });
    expect(
      scenario.session.state?.eventLog
        .filter((entry) => entry.event.eventType === TriggerCondition.ON_LEAVE_STAGE)
        .map((entry) => entry.event.cardInstanceId)
    ).toEqual([scenario.sourceId]);
    expect(
      scenario.session.state?.actionHistory.find(
        (action) =>
          action.type === 'PAY_COST' && action.payload.abilityId === selfSacrificeCase.abilityId
      )?.payload
    ).toMatchObject({
      sourceCardId: scenario.sourceId,
      movedCardIds: expect.arrayContaining([scenario.sourceId, scenario.grantedCardId]),
    });
  });
});

describe('PL!SP-pb2-005 恋宿主的每回合次数按宿主实例与 lifecycle 记录', () => {
  it('下方原卡本回合已经发动不占宿主次数，宿主第二次发动被拒绝', () => {
    const cardCase = CASES.find(
      (entry) => entry.abilityId === SP_BP5_020_ACTIVATED_PAY_TWO_ENERGY_DRAW_ONE_ABILITY_ID
    )!;
    const scenario = setupScenario(cardCase, 'DIRECT');
    const directSourceId = scenario.sourceId;

    expect(activate(scenario).success).toBe(true);

    const ren = member(REN_CODE, 'ren-after-direct-use', { name: '葉月 恋', cost: 20 });
    let game = registerCards(scenario.session.state!, [ren]);
    game = updatePlayer(game, P1, (player) => {
      let memberSlots = removeCardFromSlot(player.memberSlots, SlotPosition.CENTER);
      memberSlots = placeCardInSlot(memberSlots, SlotPosition.CENTER, ren.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      });
      memberSlots = addMemberBelowMember(memberSlots, SlotPosition.CENTER, directSourceId);
      return { ...player, memberSlots };
    });
    setSessionState(scenario.session, game);

    const hostScenario: Scenario = {
      ...scenario,
      sourceId: ren.instanceId,
      grantedCardId: directSourceId,
    };
    expect(activate(hostScenario).success).toBe(true);
    expect(activate(hostScenario).success).toBe(false);

    const useActions = scenario.session.state!.actionHistory.filter(
      (action) =>
        action.type === 'RESOLVE_ABILITY' &&
        action.payload.abilityId === cardCase.abilityId &&
        action.payload.step === 'ABILITY_USE'
    );
    expect(useActions.map((action) => action.payload.sourceCardId)).toEqual([
      directSourceId,
      ren.instanceId,
    ]);
    expect(useActions[0]?.payload.sourceLifecycleId).toBeTruthy();
    expect(useActions[1]?.payload.sourceLifecycleId).toBeTruthy();
    expect(useActions[1]?.payload.sourceLifecycleId).not.toBe(
      useActions[0]?.payload.sourceLifecycleId
    );
  });
});

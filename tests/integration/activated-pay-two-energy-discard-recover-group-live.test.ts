import { describe, expect, it } from 'vitest';
import type { EnergyCardData, LiveCardData, MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon, createHeartRequirement } from '../../src/domain/entities/card';
import { registerCards, updatePlayer, type GameState } from '../../src/domain/entities/game';
import { addCardToZone, addCardToStatefulZone, placeCardInSlot, removeCardFromSlot } from '../../src/domain/entities/zone';
import {
  HS_PB1_003_AUTO_HAND_TO_WAITING_GAIN_HEART_BLADE_ABILITY_ID,
  N_BP5_014_ACTIVATED_PAY_TWO_ENERGY_DISCARD_RECOVER_NIJIGASAKI_LIVE_ABILITY_ID,
  N_SD1_009_ACTIVATED_PAY_TWO_ENERGY_DISCARD_RECOVER_NIJIGASAKI_LIVE_ABILITY_ID,
  SP_SD2_006_ACTIVATED_PAY_TWO_ENERGY_DISCARD_RECOVER_LIELLA_LIVE_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import { getCardAbilityDefinitions } from '../../src/application/card-effect-runner';
import {
  createActivateAbilityCommand,
  createAutoAdvancePublicCardSelectionCommand,
  createConfirmEffectStepCommand,
} from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import { createPublicObjectId, projectPlayerViewState } from '../../src/online/projector';
import {
  CardType,
  FaceState,
  GamePhase,
  HeartColor,
  OrientationState,
  SlotPosition,
  SubPhase,
  TurnType,
} from '../../src/shared/types/enums';
import {
  CardAbilityCategory,
  CardAbilitySourceZone,
} from '../../src/application/card-effects/ability-definition-types';

const P1 = 'player1';
const P2 = 'player2';

const CASES = [
  {
    label: 'PL!N-bp5-014 费用4「中須かすみ」',
    sourceCode: 'PL!N-bp5-014-N',
    sourceName: '中須かすみ',
    sourceCost: 4,
    sourceGroup: '虹ヶ咲',
    abilityId: N_BP5_014_ACTIVATED_PAY_TWO_ENERGY_DISCARD_RECOVER_NIJIGASAKI_LIVE_ABILITY_ID,
    targetGroup: '虹ヶ咲',
    discardCopy: {
      stepText: '请选择1张手牌放置入休息室。',
      selectionLabel: '选择要放置入休息室的手牌',
      confirmSelectionLabel: '支付费用',
    },
    recoveryCopy: {
      stepText: '请选择自己休息室1张「虹ヶ咲」LIVE卡加入手牌。',
      selectionLabel: '选择加入手牌的虹咲LIVE',
      confirmSelectionLabel: '加入手牌',
    },
    discardStepId: 'N_BP5_014_SELECT_HAND_CARD_TO_DISCARD',
    recoveryStepId: 'N_BP5_014_SELECT_NIJIGASAKI_LIVE_TO_HAND',
  },
  {
    label: 'PL!SP-sd2-006 费用7「桜小路きな子」',
    sourceCode: 'PL!SP-sd2-006-SD2',
    sourceName: '桜小路きな子',
    sourceCost: 7,
    sourceGroup: 'Liella!',
    abilityId: SP_SD2_006_ACTIVATED_PAY_TWO_ENERGY_DISCARD_RECOVER_LIELLA_LIVE_ABILITY_ID,
    targetGroup: 'Liella!',
    discardCopy: {
      stepText: '支付[E][E]，并选择1张手牌放置入休息室。',
      selectionLabel: '选择要放置入休息室的手牌',
      confirmSelectionLabel: '支付费用',
    },
    recoveryCopy: {
      stepText: '请选择自己的休息室中1张『Liella!』LIVE卡加入手牌。',
      selectionLabel: undefined,
      confirmSelectionLabel: undefined,
    },
    discardStepId: 'SP_SD2_006_SELECT_HAND_CARD_TO_DISCARD',
    recoveryStepId: 'SP_SD2_006_SELECT_WAITING_ROOM_LIELLA_LIVE',
  },
  {
    label: 'PL!N-sd1-009-SD 费用7「天王寺璃奈」',
    sourceCode: 'PL!N-sd1-009-SD',
    sourceName: '天王寺璃奈',
    sourceCost: 7,
    sourceGroup: '虹ヶ咲',
    abilityId: N_SD1_009_ACTIVATED_PAY_TWO_ENERGY_DISCARD_RECOVER_NIJIGASAKI_LIVE_ABILITY_ID,
    targetGroup: '虹ヶ咲',
    discardCopy: {
      stepText: '支付[E][E]，并选择1张手牌放置入休息室。',
      selectionLabel: '选择要放置入休息室的手牌',
      confirmSelectionLabel: '支付费用',
    },
    recoveryCopy: {
      stepText: '请选择自己的休息室中1张『虹咲』LIVE卡加入手牌。',
      selectionLabel: '选择要加入手牌的虹咲LIVE',
      confirmSelectionLabel: '加入手牌',
    },
    discardStepId: 'N_SD1_009_SELECT_HAND_CARD_TO_DISCARD',
    recoveryStepId: 'N_SD1_009_SELECT_WAITING_ROOM_NIJIGASAKI_LIVE',
  },
] as const;

type CardCase = (typeof CASES)[number];

function member(
  cardCode: string,
  ownerId = P1,
  options: { readonly name?: string; readonly group?: string; readonly cost?: number; readonly unitName?: string; readonly instanceId?: string } = {}
) {
  const data: MemberCardData = {
    cardCode,
    name: options.name ?? cardCode,
    groupNames: [options.group ?? '虹ヶ咲'],
    unitName: options.unitName,
    cardType: CardType.MEMBER,
    cost: options.cost ?? 2,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
  return createCardInstance(data, ownerId, options.instanceId ?? cardCode);
}

function live(cardCode: string, group: string, ownerId = P1) {
  const data: LiveCardData = {
    cardCode,
    name: cardCode,
    groupNames: [group],
    cardType: CardType.LIVE,
    score: 1,
    requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
  };
  return createCardInstance(data, ownerId, cardCode);
}

function energy(index: number) {
  const data: EnergyCardData = {
    cardCode: `ENERGY-${index}`,
    name: `ENERGY-${index}`,
    cardType: CardType.ENERGY,
  };
  return createCardInstance(data, P1, `energy-${index}`);
}

function setup(
  cardCase: CardCase,
  options: {
    readonly handCards?: readonly ReturnType<typeof createCardInstance>[];
    readonly waitingCards?: readonly ReturnType<typeof createCardInstance>[];
    readonly activeEnergyCount?: number;
    readonly energyCount?: number;
    readonly markedEnergyIndices?: readonly number[];
    readonly phase?: GamePhase;
    readonly activePlayerIndex?: number;
    readonly sourceOnStage?: boolean;
    readonly extraStageCards?: readonly { readonly card: ReturnType<typeof createCardInstance>; readonly slot: SlotPosition }[];
  } = {}
) {
  let now = 10_000;
  const session = createGameSession({ now: () => now });
  session.createGame('activated-discard-recover-group-live', P1, 'P1', P2, 'P2');
  const source = member(cardCase.sourceCode, P1, {
    name: cardCase.sourceName,
    group: cardCase.sourceGroup,
    cost: cardCase.sourceCost,
  });
  const discard = member('HAND-DISCARD');
  const target = live('WAITING-TARGET-LIVE', cardCase.targetGroup);
  const handCards = options.handCards ?? [discard];
  const waitingCards = options.waitingCards ?? [target];
  const energyCount = options.energyCount ?? Math.max(2, options.activeEnergyCount ?? 2);
  const activeEnergyCount = options.activeEnergyCount ?? energyCount;
  const energies = Array.from({ length: energyCount }, (_, index) => energy(index));
  let game = registerCards(session.state!, [
    source,
    ...handCards,
    ...waitingCards,
    ...energies,
    ...(options.extraStageCards ?? []).map((entry) => entry.card),
  ]);
  game = {
    ...game,
    currentPhase: options.phase ?? GamePhase.MAIN_PHASE,
    currentSubPhase: SubPhase.NONE,
    currentTurnType: TurnType.NORMAL,
    activePlayerIndex: options.activePlayerIndex ?? 0,
    waitingPlayerId: null,
    energyActivePhaseSkips: (options.markedEnergyIndices ?? []).map((index) => ({
      playerId: P1,
      energyCardId: energies[index]!.instanceId,
      sourceCardId: 'special-energy-marker',
      abilityId: 'special-energy-marker',
    })),
  };
  game = updatePlayer(game, P1, (player) => {
    let memberSlots = player.memberSlots;
    if (options.sourceOnStage !== false) {
      memberSlots = placeCardInSlot(memberSlots, SlotPosition.CENTER, source.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      });
    }
    for (const entry of options.extraStageCards ?? []) {
      memberSlots = placeCardInSlot(memberSlots, entry.slot, entry.card.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      });
    }
    return {
      ...player,
      memberSlots,
      hand: handCards.reduce((zone, card) => addCardToZone(zone, card.instanceId), player.hand),
      waitingRoom: waitingCards.reduce(
        (zone, card) => addCardToZone(zone, card.instanceId),
        player.waitingRoom
      ),
      energyZone: energies.reduce(
        (zone, card, index) =>
          addCardToStatefulZone(zone, card.instanceId, {
            orientation: index < activeEnergyCount ? OrientationState.ACTIVE : OrientationState.WAITING,
            face: FaceState.FACE_UP,
          }),
        player.energyZone
      ),
    };
  });
  (session as unknown as { authorityState: GameState }).authorityState = game;
  return {
    session,
    source,
    discard: handCards[0]!,
    target: waitingCards[0],
    energies,
    setNow(value: number) {
      now = value;
    },
  };
}

function activate(scenario: ReturnType<typeof setup>, cardCase: CardCase, playerId = P1) {
  return scenario.session.executeCommand(
    createActivateAbilityCommand(playerId, scenario.source.instanceId, cardCase.abilityId)
  );
}

function confirmOne(scenario: ReturnType<typeof setup>, cardId: string, playerId = P1) {
  return scenario.session.executeCommand(
    createConfirmEffectStepCommand(playerId, scenario.session.state!.activeEffect!.id, cardId)
  );
}

function confirmMany(scenario: ReturnType<typeof setup>, cardIds: readonly string[]) {
  return scenario.session.executeCommand(
    createConfirmEffectStepCommand(
      P1,
      scenario.session.state!.activeEffect!.id,
      undefined,
      undefined,
      undefined,
      undefined,
      cardIds
    )
  );
}

function advancePublicSelection(scenario: ReturnType<typeof setup>, playerId = P2) {
  const effect = scenario.session.state!.activeEffect!;
  const deadline = effect.publicCardSelectionAutoAdvanceAt!;
  scenario.setNow(deadline);
  return scenario.session.executeCommand(
    createAutoAdvancePublicCardSelectionCommand(playerId, effect.id, deadline)
  );
}

function payCostActions(game: GameState, abilityId: string) {
  return game.actionHistory.filter(
    (action) => action.type === 'PAY_COST' && action.payload.abilityId === abilityId
  );
}

function abilityUseActions(game: GameState, abilityId: string) {
  return game.actionHistory.filter(
    (action) =>
      action.type === 'RESOLVE_ABILITY' &&
      action.payload.abilityId === abilityId &&
      action.payload.step === 'ABILITY_USE'
  );
}

describe('shared activated pay-two-energy discard recover group LIVE family', () => {
  it.each(CASES)('$label starts through its real definition/command and completes the shared public recovery lifecycle', (cardCase) => {
    const scenario = setup(cardCase);
    const activated = activate(scenario, cardCase);
    expect(activated.success, activated.error).toBe(true);
    expect(scenario.session.state?.activeEffect).toMatchObject({
      abilityId: cardCase.abilityId,
      stepId: cardCase.discardStepId,
      canSkipSelection: false,
      selectableCardIds: [scenario.discard.instanceId],
    });
    expect(scenario.session.state?.activeEffect?.stepText).toBe(cardCase.discardCopy.stepText);
    expect(scenario.session.state?.activeEffect?.selectionLabel).toBe(cardCase.discardCopy.selectionLabel);
    expect(scenario.session.state?.activeEffect?.confirmSelectionLabel).toBe(
      cardCase.discardCopy.confirmSelectionLabel
    );
    expect(confirmOne(scenario, scenario.discard.instanceId).success).toBe(true);
    expect(scenario.session.state?.activeEffect).toMatchObject({
      stepId: cardCase.recoveryStepId,
      selectableCardIds: [scenario.target!.instanceId],
      canSkipSelection: false,
    });
    expect(scenario.session.state?.activeEffect?.stepText).toBe(cardCase.recoveryCopy.stepText);
    expect(scenario.session.state?.activeEffect?.selectionLabel).toBe(cardCase.recoveryCopy.selectionLabel);
    expect(scenario.session.state?.activeEffect?.confirmSelectionLabel).toBe(
      cardCase.recoveryCopy.confirmSelectionLabel
    );
    const payCost = payCostActions(scenario.session.state!, cardCase.abilityId);
    expect(payCost).toHaveLength(1);
    expect(payCost[0]!.payload).toMatchObject({
      energyCardIds: scenario.energies.map((card) => card.instanceId),
      discardedHandCardIds: [scenario.discard.instanceId],
    });
    expect(abilityUseActions(scenario.session.state!, cardCase.abilityId)).toHaveLength(1);

    expect(confirmOne(scenario, scenario.target!.instanceId).success).toBe(true);
    const confirmation = scenario.session.state!.activeEffect!;
    expect(confirmation).toMatchObject({
      stepId: 'COMMON_PUBLIC_CARD_SELECTION_CONFIRMATION',
      revealedCardIds: [scenario.target!.instanceId],
      publicCardSelectionAutoAdvanceAt: 12_000,
    });
    expect(scenario.session.state!.players[0].waitingRoom.cardIds).toContain(scenario.target!.instanceId);
    expect(scenario.session.state!.players[0].hand.cardIds).not.toContain(scenario.target!.instanceId);
    const expectedObjectIds = [createPublicObjectId(scenario.target!.instanceId)];
    expect(projectPlayerViewState(scenario.session.state!, P1, { now: 10_000 }).activeEffect)
      .toMatchObject({ revealedObjectIds: expectedObjectIds, publicCardSelectionAutoAdvanceAfterMs: 2_000 });
    expect(projectPlayerViewState(scenario.session.state!, P2, { now: 10_000 }).activeEffect)
      .toMatchObject({ revealedObjectIds: expectedObjectIds, publicCardSelectionAutoAdvanceAfterMs: 2_000 });

    expect(advancePublicSelection(scenario).success).toBe(true);
    expect(scenario.session.state!.players[0].hand.cardIds).toContain(scenario.target!.instanceId);
    expect(scenario.session.state!.activeEffect).toBeNull();
    expect(payCostActions(scenario.session.state!, cardCase.abilityId)).toHaveLength(1);
  });

  it('keeps all three ability identities unique and registered exactly once', () => {
    for (const cardCase of CASES) {
      const definitions = getCardAbilityDefinitions(cardCase.sourceCode).filter(
        (definition) => definition.abilityId === cardCase.abilityId
      );
      expect(definitions).toHaveLength(1);
      expect(definitions[0]).toMatchObject({
        category: CardAbilityCategory.ACTIVATED,
        sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
        queued: false,
        implemented: true,
        perTurnLimit: 1,
      });
    }
    expect(new Set(CASES.map((cardCase) => cardCase.abilityId)).size).toBe(3);
  });

  it.each([
    { label: '非主要阶段', options: { phase: GamePhase.LIVE_SET_PHASE } },
    { label: '非主动玩家', options: { activePlayerIndex: 1 } },
    { label: '来源不在舞台', options: { sourceOnStage: false } },
    { label: '活跃能量不足', options: { energyCount: 2, activeEnergyCount: 1 } },
    { label: '没有手牌', options: { handCards: [] } },
  ])('rejects the $label gate without paying or recording turn use', ({ options }) => {
    const cardCase = CASES[2];
    const scenario = setup(cardCase, options);
    expect(activate(scenario, cardCase).success).toBe(false);
    expect(scenario.session.state?.activeEffect).toBeNull();
    expect(payCostActions(scenario.session.state!, cardCase.abilityId)).toHaveLength(0);
    expect(abilityUseActions(scenario.session.state!, cardCase.abilityId)).toHaveLength(0);
  });

  it('enforces per-turn use by source instance while allowing a second matching source instance', () => {
    const cardCase = CASES[2];
    const scenario = setup(cardCase, { waitingCards: [] });
    expect(activate(scenario, cardCase).success).toBe(true);
    expect(confirmOne(scenario, scenario.discard.instanceId).success).toBe(true);
    const secondSource = member(cardCase.sourceCode, P1, {
      name: cardCase.sourceName,
      group: cardCase.sourceGroup,
      cost: 7,
      instanceId: 'second-rina-source',
    });
    const secondHand = member('SECOND-HAND');
    const extraEnergies = [energy(10), energy(11)];
    let state = registerCards(scenario.session.state!, [secondSource, secondHand, ...extraEnergies]);
    state = updatePlayer(state, P1, (player) => ({
      ...player,
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.LEFT, secondSource.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }),
      hand: addCardToZone(player.hand, secondHand.instanceId),
      energyZone: extraEnergies.reduce(
        (zone, card) => addCardToStatefulZone(zone, card.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }),
        player.energyZone
      ),
    }));
    (scenario.session as unknown as { authorityState: GameState }).authorityState = state;
    expect(activate(scenario, cardCase).success).toBe(false);
    expect(
      scenario.session.executeCommand(
        createActivateAbilityCommand(P1, secondSource.instanceId, cardCase.abilityId)
      ).success
    ).toBe(true);
  });

  it('automatically pays the first two ordinary ACTIVE energy in stable order when ordinary candidates exceed the cost', () => {
    const cardCase = CASES[2];
    const scenario = setup(cardCase, { energyCount: 4, activeEnergyCount: 4, waitingCards: [] });
    activate(scenario, cardCase);
    confirmOne(scenario, scenario.discard.instanceId);
    expect(payCostActions(scenario.session.state!, cardCase.abilityId)[0]!.payload.energyCardIds).toEqual(
      scenario.energies.slice(0, 2).map((card) => card.instanceId)
    );
    expect(
      scenario.energies.map((card) => scenario.session.state!.players[0].energyZone.cardStates.get(card.instanceId)?.orientation)
    ).toEqual([
      OrientationState.WAITING,
      OrientationState.WAITING,
      OrientationState.ACTIVE,
      OrientationState.ACTIVE,
    ]);
  });

  it('uses the common special-energy window, records the exact selected cards, and atomically rejects invalid or stale selections', () => {
    const cardCase = CASES[2];
    const scenario = setup(cardCase, { energyCount: 4, activeEnergyCount: 4, markedEnergyIndices: [1] });
    activate(scenario, cardCase);
    confirmOne(scenario, scenario.discard.instanceId);
    const windowState = scenario.session.state!;
    expect(windowState.activeEffect).toMatchObject({
      stepId: 'COMMON_ENERGY_OPERATION_SELECTION',
      stepText: '请选择用于支付[E][E]的活跃能量卡。',
      selectionLabel: '选择用于支付费用的能量卡',
      confirmSelectionLabel: '支付费用',
      minSelectableCards: 2,
      maxSelectableCards: 2,
      selectableCardIds: scenario.energies.map((card) => card.instanceId),
    });
    const ids = scenario.energies.map((card) => card.instanceId);
    for (const invalid of [[ids[0]!], [ids[0]!, ids[0]!], [ids[0]!, 'outside-energy']]) {
      expect(confirmMany(scenario, invalid).success).toBe(false);
      expect(scenario.session.state).toBe(windowState);
    }
    const stale = updatePlayer(windowState, P1, (player) => ({
      ...player,
      energyZone: {
        ...player.energyZone,
        cardStates: new Map(player.energyZone.cardStates).set(ids[1]!, {
          orientation: OrientationState.WAITING,
          face: FaceState.FACE_UP,
        }),
      },
    }));
    (scenario.session as unknown as { authorityState: GameState }).authorityState = stale;
    expect(confirmMany(scenario, [ids[0]!, ids[1]!]).success).toBe(false);
    expect(payCostActions(scenario.session.state!, cardCase.abilityId)).toHaveLength(0);
    expect(scenario.session.state!.players[0].hand.cardIds).toContain(scenario.discard.instanceId);

    const removedFromEnergyZone = updatePlayer(windowState, P1, (player) => ({
      ...player,
      energyZone: {
        ...player.energyZone,
        cardIds: player.energyZone.cardIds.filter((id) => id !== ids[2]),
      },
    }));
    (scenario.session as unknown as { authorityState: GameState }).authorityState =
      removedFromEnergyZone;
    expect(confirmMany(scenario, [ids[0]!, ids[2]!]).success).toBe(false);
    expect(payCostActions(scenario.session.state!, cardCase.abilityId)).toHaveLength(0);

    (scenario.session as unknown as { authorityState: GameState }).authorityState = windowState;
    const chosen = [ids[1]!, ids[3]!];
    expect(confirmMany(scenario, chosen).success).toBe(true);
    expect(payCostActions(scenario.session.state!, cardCase.abilityId)[0]!.payload).toMatchObject({
      energyCardIds: chosen,
      discardedHandCardIds: [scenario.discard.instanceId],
    });
  });

  it('does not pay when the selected hand card or source becomes stale before discard confirmation or energy restoration', () => {
    const cardCase = CASES[2];
    const handStale = setup(cardCase);
    activate(handStale, cardCase);
    const withoutHand = updatePlayer(handStale.session.state!, P1, (player) => ({
      ...player,
      hand: { ...player.hand, cardIds: [] },
      waitingRoom: addCardToZone(player.waitingRoom, handStale.discard.instanceId),
    }));
    (handStale.session as unknown as { authorityState: GameState }).authorityState = withoutHand;
    expect(confirmOne(handStale, handStale.discard.instanceId).success).toBe(false);
    expect(payCostActions(handStale.session.state!, cardCase.abilityId)).toHaveLength(0);
    expect(abilityUseActions(handStale.session.state!, cardCase.abilityId)).toHaveLength(0);

    const sourceBeforeDiscard = setup(cardCase);
    activate(sourceBeforeDiscard, cardCase);
    const sourceGoneBeforeDiscard = updatePlayer(sourceBeforeDiscard.session.state!, P1, (player) => ({
      ...player,
      memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.CENTER),
      waitingRoom: addCardToZone(player.waitingRoom, sourceBeforeDiscard.source.instanceId),
    }));
    (sourceBeforeDiscard.session as unknown as { authorityState: GameState }).authorityState =
      sourceGoneBeforeDiscard;
    expect(confirmOne(sourceBeforeDiscard, sourceBeforeDiscard.discard.instanceId).success).toBe(false);
    expect(payCostActions(sourceBeforeDiscard.session.state!, cardCase.abilityId)).toHaveLength(0);
    expect(sourceBeforeDiscard.session.state!.players[0].hand.cardIds).toContain(
      sourceBeforeDiscard.discard.instanceId
    );

    const sourceStale = setup(cardCase, { energyCount: 3, markedEnergyIndices: [0] });
    activate(sourceStale, cardCase);
    confirmOne(sourceStale, sourceStale.discard.instanceId);
    const withoutSource = updatePlayer(sourceStale.session.state!, P1, (player) => ({
      ...player,
      memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.CENTER),
      waitingRoom: addCardToZone(player.waitingRoom, sourceStale.source.instanceId),
    }));
    (sourceStale.session as unknown as { authorityState: GameState }).authorityState = withoutSource;
    confirmMany(sourceStale, sourceStale.energies.slice(0, 2).map((card) => card.instanceId));
    expect(payCostActions(sourceStale.session.state!, cardCase.abilityId)).toHaveLength(0);
    expect(sourceStale.session.state!.players[0].hand.cardIds).toContain(sourceStale.discard.instanceId);
  });

  it('rescans after payment, allows the just-discarded legal LIVE, and excludes wrong-group LIVE, members, and cards outside waiting room', () => {
    const cardCase = CASES[2];
    const discardedLive = live('JUST-DISCARDED-NIJI-LIVE', '虹ヶ咲');
    const wrongGroup = live('WRONG-GROUP-LIVE', 'Liella!');
    const waitingMember = member('WAITING-MEMBER');
    const outsideLive = live('OUTSIDE-LIVE', '虹ヶ咲');
    const scenario = setup(cardCase, {
      handCards: [discardedLive, outsideLive],
      waitingCards: [wrongGroup, waitingMember],
    });
    activate(scenario, cardCase);
    confirmOne(scenario, discardedLive.instanceId);
    expect(scenario.session.state?.activeEffect?.selectableCardIds).toEqual([discardedLive.instanceId]);
  });

  it('keeps costs and turn use on no-target, then runs unified continuation without leaving pending state', () => {
    const cardCase = CASES[1];
    const scenario = setup(cardCase, { waitingCards: [live('NIJI-LIVE', '虹ヶ咲')] });
    activate(scenario, cardCase);
    confirmOne(scenario, scenario.discard.instanceId);
    expect(scenario.session.state?.activeEffect).toBeNull();
    expect(payCostActions(scenario.session.state!, cardCase.abilityId)).toHaveLength(1);
    expect(abilityUseActions(scenario.session.state!, cardCase.abilityId)).toHaveLength(1);
    expect(scenario.session.state?.pendingChoice).toBeNull();
    expect(scenario.session.state?.pendingAbilities).toEqual([]);
  });

  it('does not insert discard triggers between cost and recovery, but resolves them after the family workflow finishes', () => {
    const cardCase = CASES[1];
    const triggerSource = member('PL!HS-pb1-003-R', P1, {
      name: '大沢瑠璃乃',
      group: '蓮ノ空',
      unitName: 'みらくらぱーく！',
    });
    const scenario = setup(cardCase, {
      extraStageCards: [{ card: triggerSource, slot: SlotPosition.LEFT }],
    });
    activate(scenario, cardCase);
    confirmOne(scenario, scenario.discard.instanceId);
    expect(scenario.session.state?.activeEffect?.stepId).toBe(cardCase.recoveryStepId);
    expect(
      scenario.session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId === HS_PB1_003_AUTO_HAND_TO_WAITING_GAIN_HEART_BLADE_ABILITY_ID
      )
    ).toBe(false);
    confirmOne(scenario, scenario.target!.instanceId);
    advancePublicSelection(scenario);
    expect(
      scenario.session.state?.actionHistory.some(
        (action) =>
          action.payload.abilityId === HS_PB1_003_AUTO_HAND_TO_WAITING_GAIN_HEART_BLADE_ABILITY_ID &&
          action.payload.step === 'GAIN_PINK_HEART_AND_BLADE_FROM_HAND_TO_WAITING'
      )
    ).toBe(true);
    expect(scenario.session.state?.activeEffect).toBeNull();
    expect(scenario.session.state?.pendingChoice).toBeNull();
    expect(scenario.session.state?.pendingAbilities).toEqual([]);
  });

  it('revalidates a stale public target at the deadline and makes repeated expiry requests idempotent', () => {
    const cardCase = CASES[2];
    const scenario = setup(cardCase);
    activate(scenario, cardCase);
    confirmOne(scenario, scenario.discard.instanceId);
    confirmOne(scenario, scenario.target!.instanceId);
    const effect = scenario.session.state!.activeEffect!;
    const stale = updatePlayer(scenario.session.state!, P1, (player) => ({
      ...player,
      waitingRoom: {
        ...player.waitingRoom,
        cardIds: player.waitingRoom.cardIds.filter((id) => id !== scenario.target!.instanceId),
      },
      hand: addCardToZone(player.hand, scenario.target!.instanceId),
    }));
    (scenario.session as unknown as { authorityState: GameState }).authorityState = stale;
    scenario.setNow(effect.publicCardSelectionAutoAdvanceAt!);
    expect(
      scenario.session.executeCommand(
        createAutoAdvancePublicCardSelectionCommand(P2, effect.id, effect.publicCardSelectionAutoAdvanceAt!)
      ).success
    ).toBe(true);
    const resolved = scenario.session.state!;
    expect(resolved.players[0].hand.cardIds.filter((id) => id === scenario.target!.instanceId)).toHaveLength(1);
    expect(resolved.activeEffect).toBeNull();
    expect(
      scenario.session.executeCommand(
        createAutoAdvancePublicCardSelectionCommand(P1, effect.id, effect.publicCardSelectionAutoAdvanceAt!)
      ).success
    ).toBe(false);
    expect(scenario.session.state).toBe(resolved);
  });

  it('keeps the new Rina definition and player-visible copy exact', () => {
    const definition = getCardAbilityDefinitions('PL!N-sd1-009-SD').find(
      (candidate) => candidate.abilityId === N_SD1_009_ACTIVATED_PAY_TWO_ENERGY_DISCARD_RECOVER_NIJIGASAKI_LIVE_ABILITY_ID
    );
    const effectText =
      '【起动】【1回合1次】[E][E]将1张手牌放置入休息室：从自己的休息室将1张『虹咲』的LIVE卡加入手牌。';
    expect(definition?.effectText).toBe(effectText);
    expect(definition?.activatedUi).toEqual({
      abilityId: N_SD1_009_ACTIVATED_PAY_TWO_ENERGY_DISCARD_RECOVER_NIJIGASAKI_LIVE_ABILITY_ID,
      title: '支付[E][E]并弃1手，回收1张虹咲LIVE',
      text: effectText,
    });
    const scenario = setup(CASES[2], { energyCount: 3, markedEnergyIndices: [0] });
    activate(scenario, CASES[2]);
    expect(scenario.session.state?.activeEffect).toMatchObject({
      effectText,
      stepText: '支付[E][E]，并选择1张手牌放置入休息室。',
      selectionLabel: '选择要放置入休息室的手牌',
      confirmSelectionLabel: '支付费用',
    });
    confirmOne(scenario, scenario.discard.instanceId);
    expect(scenario.session.state?.activeEffect).toMatchObject({
      stepText: '请选择用于支付[E][E]的活跃能量卡。',
      selectionLabel: '选择用于支付费用的能量卡',
      confirmSelectionLabel: '支付费用',
    });
  });
});

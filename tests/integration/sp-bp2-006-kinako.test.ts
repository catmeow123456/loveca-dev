import { describe, expect, it } from 'vitest';
import { addCheckTimingRuleSentinel } from '../helpers/check-timing-rule-sentinel';
import {
  createCardInstance,
  createHeartIcon,
  type CardInstance,
  type EnergyCardData,
  type MemberCardData,
} from '../../src/domain/entities/card';
import {
  addAction,
  createGameState,
  registerCards,
  updatePlayer,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { addCardToZone, placeCardInSlot } from '../../src/domain/entities/zone';
import {
  activateCardAbility,
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { getCardAbilityDefinitionsForCardCode } from '../../src/application/card-effects/definitions/lookup';
import {
  GENERIC_DISCARD_LOOK_TOP_ABILITY_ID,
  HS_PB1_003_AUTO_HAND_TO_WAITING_GAIN_HEART_BLADE_ABILITY_ID,
  KEKE_ON_ENTER_PLACE_WAITING_ENERGY_ABILITY_ID,
  PL_N_BP3_003_ON_ENTER_ACTIVATE_WAITING_LOW_COST_NIJIGASAKI_MEMBER_ON_ENTER_ABILITY_ID,
  SP_BP1_002_ON_ENTER_LEFT_PAY_TWO_ENERGY_DRAW_TWO_ABILITY_ID,
  SP_BP2_005_ON_ENTER_PAY_TWO_ENERGY_LOOK_TOP_SEVEN_LIELLA_CARD_ABILITY_ID,
  SP_BP2_006_ACTIVATED_DISCARD_LOW_COST_LIELLA_MEMBER_ACTIVATE_ON_ENTER_ABILITY_ID,
  SP_BP2_006_ON_ENTER_RELAY_RECOVER_REPLACED_LIELLA_MEMBER_ABILITY_ID,
  SP_PB1_009_ON_ENTER_OTHER_FIVEYNCRISE_DRAW_ONE_ABILITY_ID,
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

const P1 = 'p1';
function member(
  cardCode: string,
  group = 'Liella!',
  cost = 2,
  unit = group
): MemberCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames: [group],
    unitName: unit,
    cardType: CardType.MEMBER,
    cost,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.YELLOW, 1)],
  };
}

function energy(id: string): CardInstance {
  const data: EnergyCardData = {
    cardCode: `ENERGY-${id}`,
    name: id,
    cardType: CardType.ENERGY,
  };
  return createCardInstance(data, P1, id);
}

function activatedGame(options: {
  readonly source: CardInstance;
  readonly sourceSlot?: SlotPosition;
  readonly hand: readonly CardInstance[];
  readonly stage?: readonly {
    readonly card: CardInstance;
    readonly slot: SlotPosition;
  }[];
  readonly energies?: readonly CardInstance[];
  readonly energyDeck?: readonly CardInstance[];
  readonly mainDeck?: readonly CardInstance[];
}) {
  const stage = options.stage ?? [];
  const energies = options.energies ?? [];
  const energyDeck = options.energyDeck ?? [];
  const mainDeck = options.mainDeck ?? [];
  let game = registerCards(
    createGameState(`activated-${options.source.instanceId}`, P1, 'P1', 'p2', 'P2'),
    [
      options.source,
      ...options.hand,
      ...stage.map((entry) => entry.card),
      ...energies,
      ...energyDeck,
      ...mainDeck,
    ]
  );
  game = updatePlayer(game, P1, (player) => {
    let memberSlots = placeCardInSlot(
      player.memberSlots,
      options.sourceSlot ?? SlotPosition.CENTER,
      options.source.instanceId,
      { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }
    );
    for (const entry of stage) {
      memberSlots = placeCardInSlot(memberSlots, entry.slot, entry.card.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      });
    }
    return {
      ...player,
      memberSlots,
      hand: { ...player.hand, cardIds: options.hand.map((card) => card.instanceId) },
      energyZone: {
        ...player.energyZone,
        cardIds: energies.map((card) => card.instanceId),
        cardStates: new Map(
          energies.map((card) => [
            card.instanceId,
            { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP },
          ])
        ),
      },
      energyDeck: {
        ...player.energyDeck,
        cardIds: energyDeck.map((card) => card.instanceId),
      },
      mainDeck: { ...player.mainDeck, cardIds: mainDeck.map((card) => card.instanceId) },
    };
  });
  return {
    ...game,
    currentPhase: GamePhase.MAIN_PHASE,
    currentSubPhase: SubPhase.NONE,
    activePlayerIndex: 0,
  };
}

describe('PL!SP-bp2-006 Kinako', () => {
  it.each(['PL!SP-bp2-006-R＋', 'PL!SP-bp2-006-P', 'PL!SP-bp2-006-P＋', 'PL!SP-bp2-006-SEC'])('classifies %s without matching pb2', (code) => {
    const ids = getCardAbilityDefinitionsForCardCode(code).map((d) => d.abilityId);
    expect(ids).toEqual(expect.arrayContaining([SP_BP2_006_ON_ENTER_RELAY_RECOVER_REPLACED_LIELLA_MEMBER_ABILITY_ID, SP_BP2_006_ACTIVATED_DISCARD_LOW_COST_LIELLA_MEMBER_ACTIVATE_ON_ENTER_ABILITY_ID]));
    expect(ids.some((id) => id.includes('pb2-006'))).toBe(false);
  });

  it('recovers only the Liella member in this relay snapshot, not an old waiting-room card', () => {
    const source = createCardInstance(member('PL!SP-bp2-006-R＋', 'Liella!', 10), P1, 'kinako');
    const replaced = createCardInstance(member('relay-liella'), P1, 'relay');
    const old = createCardInstance(member('old-liella'), P1, 'old');
    let game = registerCards(createGameState('relay', P1, 'P1', 'p2', 'P2'), [source, replaced, old]);
    game = updatePlayer(game, P1, (p) => ({ ...p, waitingRoom: { ...p.waitingRoom, cardIds: [old.instanceId, replaced.instanceId] } }));
    const pending: PendingAbilityState = { id: 'relay-pending', abilityId: SP_BP2_006_ON_ENTER_RELAY_RECOVER_REPLACED_LIELLA_MEMBER_ABILITY_ID, sourceCardId: source.instanceId, controllerId: P1, mandatory: true, timingId: TriggerCondition.ON_ENTER_STAGE, eventIds: ['relay-enter'], metadata: { relayReplacements: [{ cardId: replaced.instanceId }] } };
    const done = resolvePendingCardEffects({ ...game, pendingAbilities: [pending] }).gameState;
    expect(done.players[0].hand.cardIds).toContain(replaced.instanceId);
    expect(done.players[0].waitingRoom.cardIds).toContain(old.instanceId);
    expect(done.eventLog.some((entry) => entry.event.eventType === TriggerCondition.ON_ENTER_HAND)).toBe(true);
  });

  it('forces a choice among multiple valid relay replacements and filters non-Liella, opponent, and stale entries', () => {
    const source = createCardInstance(member('PL!SP-bp2-006-R＋', 'Liella!', 10), P1, 'kinako');
    const first = createCardInstance(member('relay-first'), P1, 'first');
    const second = createCardInstance(member('relay-second'), P1, 'second');
    const nonLiella = createCardInstance(member('relay-other', '虹ヶ咲'), P1, 'other');
    const opponent = createCardInstance(member('relay-opponent'), 'p2', 'opponent');
    const stale = createCardInstance(member('relay-stale'), P1, 'stale');
    let game = registerCards(createGameState('relay-multi', P1, 'P1', 'p2', 'P2'), [source, first, second, nonLiella, opponent, stale]);
    game = updatePlayer(game, P1, (p) => ({ ...p, waitingRoom: { ...p.waitingRoom, cardIds: [first.instanceId, second.instanceId, nonLiella.instanceId, opponent.instanceId] } }));
    const pending: PendingAbilityState = { id: 'relay-multi', abilityId: SP_BP2_006_ON_ENTER_RELAY_RECOVER_REPLACED_LIELLA_MEMBER_ABILITY_ID, sourceCardId: source.instanceId, controllerId: P1, mandatory: true, timingId: TriggerCondition.ON_ENTER_STAGE, eventIds: ['relay'], metadata: { relayReplacements: [first, second, nonLiella, opponent, stale].map((card) => ({ cardId: card.instanceId })) } };
    const started = resolvePendingCardEffects({ ...game, pendingAbilities: [pending] }).gameState;
    expect(started.activeEffect?.selectableCardIds).toEqual([first.instanceId, second.instanceId]);
    expect(started.activeEffect?.canSkipSelection).toBe(false);
  });

  it('continues later pending work when a selected relay replacement becomes stale', () => {
    const source = createCardInstance(member('PL!SP-bp2-006-R＋', 'Liella!', 10), P1, 'kinako');
    const first = createCardInstance(member('relay-first'), P1, 'first');
    const second = createCardInstance(member('relay-second'), P1, 'second');
    let game = registerCards(createGameState('relay-stale', P1, 'P1', 'p2', 'P2'), [source, first, second]);
    game = updatePlayer(game, P1, (p) => ({ ...p, waitingRoom: { ...p.waitingRoom, cardIds: [first.instanceId, second.instanceId] } }));
    const relay: PendingAbilityState = { id: 'relay-stale', abilityId: SP_BP2_006_ON_ENTER_RELAY_RECOVER_REPLACED_LIELLA_MEMBER_ABILITY_ID, sourceCardId: source.instanceId, controllerId: P1, mandatory: true, timingId: TriggerCondition.ON_ENTER_STAGE, eventIds: ['relay'], metadata: { relayReplacements: [{ cardId: first.instanceId }, { cardId: second.instanceId }] } };
    const later: PendingAbilityState = { id: 'later', abilityId: PL_N_BP3_003_ON_ENTER_ACTIVATE_WAITING_LOW_COST_NIJIGASAKI_MEMBER_ON_ENTER_ABILITY_ID, sourceCardId: 'later-source', controllerId: P1, mandatory: true, timingId: TriggerCondition.ON_ENTER_STAGE, eventIds: ['later'] };
    const order = resolvePendingCardEffects({ ...game, pendingAbilities: [relay, later] }).gameState;
    const started = confirmActiveEffectStep(order, P1, order.activeEffect!.id, source.instanceId);
    const stale = updatePlayer(started, P1, (p) => ({ ...p, waitingRoom: { ...p.waitingRoom, cardIds: p.waitingRoom.cardIds.filter((id) => id !== first.instanceId) } }));
    const done = confirmActiveEffectStep(stale, P1, stale.activeEffect!.id, first.instanceId);
    expect(done.activeEffect).toBeNull();
    expect(done.pendingAbilities).toEqual([]);
    expect(done.actionHistory.some((a) => a.payload.step === 'RELAY_REPLACEMENT_NOT_AVAILABLE')).toBe(true);
    expect(done.actionHistory.some((a) => a.payload.step === 'NO_LEGAL_WAITING_MEMBER')).toBe(true);
  });

  it('rejects non-Kinako, opponent-owned, off-stage, wrong phase, and wrong subphase sources without paying or using the turn limit', () => {
    const kinako = createCardInstance(member('PL!SP-bp2-006-R＋', 'Liella!', 10), P1, 'kinako');
    const offstageKinako = createCardInstance(member('PL!SP-bp2-006-SEC', 'Liella!', 10), P1, 'offstage-kinako');
    const impostor = createCardInstance(member('PL!SP-bp2-007-R', 'Liella!', 10), P1, 'impostor');
    const opponentKinako = createCardInstance(member('PL!SP-bp2-006-P', 'Liella!', 10), 'p2', 'opponent-kinako');
    const target = createCardInstance(member('PL!SP-bp1-005-R'), P1, 'target');
    let base = registerCards(createGameState('source-gates', P1, 'P1', 'p2', 'P2'), [kinako, offstageKinako, impostor, opponentKinako, target]);
    base = updatePlayer(base, P1, (p) => ({ ...p, memberSlots: placeCardInSlot(placeCardInSlot(p.memberSlots, SlotPosition.LEFT, impostor.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }), SlotPosition.CENTER, kinako.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }), hand: addCardToZone(p.hand, target.instanceId) }));
    base = { ...base, currentPhase: GamePhase.MAIN_PHASE, currentSubPhase: SubPhase.NONE, activePlayerIndex: 0 };
    const attempts = [
      activateCardAbility(base, P1, impostor.instanceId, SP_BP2_006_ACTIVATED_DISCARD_LOW_COST_LIELLA_MEMBER_ACTIVATE_ON_ENTER_ABILITY_ID),
      activateCardAbility(base, P1, opponentKinako.instanceId, SP_BP2_006_ACTIVATED_DISCARD_LOW_COST_LIELLA_MEMBER_ACTIVATE_ON_ENTER_ABILITY_ID),
      activateCardAbility(base, P1, offstageKinako.instanceId, SP_BP2_006_ACTIVATED_DISCARD_LOW_COST_LIELLA_MEMBER_ACTIVATE_ON_ENTER_ABILITY_ID),
      activateCardAbility({ ...base, activePlayerIndex: 1 }, P1, kinako.instanceId, SP_BP2_006_ACTIVATED_DISCARD_LOW_COST_LIELLA_MEMBER_ACTIVATE_ON_ENTER_ABILITY_ID),
      activateCardAbility({ ...base, currentPhase: GamePhase.LIVE_PHASE }, P1, kinako.instanceId, SP_BP2_006_ACTIVATED_DISCARD_LOW_COST_LIELLA_MEMBER_ACTIVATE_ON_ENTER_ABILITY_ID),
      activateCardAbility({ ...base, currentSubPhase: SubPhase.PERFORMANCE_REVEAL }, P1, kinako.instanceId, SP_BP2_006_ACTIVATED_DISCARD_LOW_COST_LIELLA_MEMBER_ACTIVATE_ON_ENTER_ABILITY_ID),
    ];
    for (const attempt of attempts) {
      expect(attempt.activeEffect).toBeNull();
      expect(attempt.actionHistory.some((a) => a.type === 'PAY_COST' || a.payload.step === 'ABILITY_USE')).toBe(false);
      expect(attempt.players[0].hand.cardIds).toContain(target.instanceId);
    }
  });

  it('uses private hand candidates, pays through the discard wrapper, then delegates before later pending work', () => {
    const source = createCardInstance(member('PL!SP-bp2-006-R＋', 'Liella!', 10), P1, 'kinako');
    const target = createCardInstance(member('PL!SP-bp1-005-R'), P1, 'target');
    const originalCost = createCardInstance(member('original-cost'), P1, 'original-cost');
    const observer = createCardInstance(member('PL!HS-pb1-003-R', '蓮ノ空', 10), P1, 'observer');
    let game = registerCards(createGameState('activated', P1, 'P1', 'p2', 'P2'), [source, target, originalCost, observer]);
    game = updatePlayer(game, P1, (p) => ({ ...p, memberSlots: placeCardInSlot(placeCardInSlot(p.memberSlots, SlotPosition.CENTER, source.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }), SlotPosition.LEFT, observer.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }), hand: { ...p.hand, cardIds: [target.instanceId, originalCost.instanceId] } }));
    const later: PendingAbilityState = { id: 'existing-later', abilityId: PL_N_BP3_003_ON_ENTER_ACTIVATE_WAITING_LOW_COST_NIJIGASAKI_MEMBER_ON_ENTER_ABILITY_ID, sourceCardId: 'later-source', controllerId: P1, mandatory: true, timingId: TriggerCondition.ON_ENTER_STAGE, eventIds: ['later'] };
    game = { ...game, currentPhase: GamePhase.MAIN_PHASE, currentSubPhase: SubPhase.NONE, activePlayerIndex: 0, pendingAbilities: [later] };
    const started = activateCardAbility(addCheckTimingRuleSentinel(game, P1, 'sp-bp2-006-continuation'), P1, source.instanceId, SP_BP2_006_ACTIVATED_DISCARD_LOW_COST_LIELLA_MEMBER_ACTIVATE_ON_ENTER_ABILITY_ID);
    expect(started.activeEffect?.selectableCardVisibility).toBe('AWAITING_PLAYER_ONLY');
    expect(started.activeEffect?.selectableCardIds).toContain(target.instanceId);
    const delegated = confirmActiveEffectStep(started, P1, started.activeEffect!.id, target.instanceId);
    expect(delegated.players[0].waitingRoom.cardIds).toContain(target.instanceId);
    expect(delegated.activeEffect?.abilityId).toBe(GENERIC_DISCARD_LOOK_TOP_ABILITY_ID);
    expect(delegated.activeEffect?.sourceCardId).toBe(target.instanceId);
    expect(delegated.eventLog.some((entry) => entry.event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM)).toBe(true);
    expect(delegated.actionHistory.some((a) => a.type === 'PAY_COST' && a.payload.sourceCardId === source.instanceId)).toBe(true);
    expect(delegated.pendingAbilities.some((p) => p.id === later.id)).toBe(true);
    expect(delegated.pendingAbilities.some((p) => p.abilityId === HS_PB1_003_AUTO_HAND_TO_WAITING_GAIN_HEART_BLADE_ABILITY_ID)).toBe(true);
    let afterOriginal = confirmActiveEffectStep(delegated, P1, delegated.activeEffect!.id);
    if (afterOriginal.activeEffect?.abilityId === 'system:select-pending-card-effect') {
      afterOriginal = confirmActiveEffectStep(afterOriginal, P1, afterOriginal.activeEffect.id, null, null, false, later.id);
    }
    expect(afterOriginal.activeEffect?.abilityId).not.toBe(GENERIC_DISCARD_LOOK_TOP_ABILITY_ID);
    expect(afterOriginal.actionHistory.findIndex((a) => a.payload.step === 'DELEGATE_WAITING_ROOM_MEMBER_ON_ENTER_ABILITY')).toBeLessThan(afterOriginal.actionHistory.findIndex((a) => a.payload.pendingAbilityId === later.id));
    const repeated = activateCardAbility({ ...delegated, activeEffect: null }, P1, source.instanceId, SP_BP2_006_ACTIVATED_DISCARD_LOW_COST_LIELLA_MEMBER_ACTIVATE_ON_ENTER_ABILITY_ID);
    expect(repeated.activeEffect).toBeNull();
  });

  it('keeps paid cost/use and continues pending work when a post-payment ability option becomes stale', () => {
    const source = createCardInstance(member('PL!SP-bp2-006-R＋', 'Liella!', 10), P1, 'kinako');
    const paidTarget = createCardInstance(member('PL!SP-bp1-005-R'), P1, 'paid-target');
    let game = registerCards(createGameState('post-pay-stale', P1, 'P1', 'p2', 'P2'), [source, paidTarget]);
    game = updatePlayer(game, P1, (p) => ({ ...p, memberSlots: placeCardInSlot(p.memberSlots, SlotPosition.CENTER, source.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }) }));
    const later: PendingAbilityState = { id: 'later', abilityId: PL_N_BP3_003_ON_ENTER_ACTIVATE_WAITING_LOW_COST_NIJIGASAKI_MEMBER_ON_ENTER_ABILITY_ID, sourceCardId: 'later-source', controllerId: P1, mandatory: true, timingId: TriggerCondition.ON_ENTER_STAGE, eventIds: ['later'] };
    game = addAction(game, 'PAY_COST', P1, { abilityId: SP_BP2_006_ACTIVATED_DISCARD_LOW_COST_LIELLA_MEMBER_ACTIVATE_ON_ENTER_ABILITY_ID, sourceCardId: source.instanceId, discardedCardIds: [paidTarget.instanceId] });
    game = addAction(game, 'RESOLVE_ABILITY', P1, { abilityId: SP_BP2_006_ACTIVATED_DISCARD_LOW_COST_LIELLA_MEMBER_ACTIVATE_ON_ENTER_ABILITY_ID, sourceCardId: source.instanceId, step: 'ABILITY_USE', turnCount: game.turnCount });
    game = { ...game, pendingAbilities: [later], activeEffect: { id: 'paid-effect', abilityId: SP_BP2_006_ACTIVATED_DISCARD_LOW_COST_LIELLA_MEMBER_ACTIVATE_ON_ENTER_ABILITY_ID, sourceCardId: source.instanceId, controllerId: P1, effectText: 'test', stepId: 'SP_BP2_006_SELECT_DISCARDED_MEMBER_ABILITY', stepText: '请选择要发动的一项【登场】能力。', awaitingPlayerId: P1, selectableOptions: [{ id: GENERIC_DISCARD_LOOK_TOP_ABILITY_ID, label: '发动能力' }], metadata: { delegatedTargetCardId: paidTarget.instanceId } } };
    const done = confirmActiveEffectStep(game, P1, 'paid-effect', null, null, undefined, GENERIC_DISCARD_LOOK_TOP_ABILITY_ID);
    expect(done.activeEffect).toBeNull();
    expect(done.players[0].hand.cardIds).not.toContain(paidTarget.instanceId);
    expect(done.actionHistory.some((a) => a.type === 'PAY_COST')).toBe(true);
    expect(done.actionHistory.some((a) => a.payload.step === 'ABILITY_USE')).toBe(true);
    expect(done.actionHistory.some((a) => a.payload.step === 'DISCARDED_MEMBER_ABILITY_NOT_AVAILABLE' && a.payload.costRemainsPaid === true)).toBe(true);
    expect(done.actionHistory.some((a) => a.payload.step === 'NO_LEGAL_WAITING_MEMBER')).toBe(true);
    expect(done.pendingAbilities).toEqual([]);
  });

  it('delegates PR-004, pays its hand cost, and places waiting energy while the source stays discarded', () => {
    const source = createCardInstance(
      member('PL!SP-bp2-006-R＋', 'Liella!', 10),
      P1,
      'kinako-keke'
    );
    const keke = createCardInstance(member('PL!SP-PR-004-PR', 'Liella!', 4), P1, 'delegated-keke');
    const discard = createCardInstance(member('discard-for-keke'), P1, 'discard-for-keke');
    const energyCard = energy('keke-energy');
    const game = activatedGame({
      source,
      hand: [keke, discard],
      energyDeck: [energyCard],
    });

    const started = activateCardAbility(
      game,
      P1,
      source.instanceId,
      SP_BP2_006_ACTIVATED_DISCARD_LOW_COST_LIELLA_MEMBER_ACTIVATE_ON_ENTER_ABILITY_ID
    );
    expect(started.activeEffect?.selectableCardIds).toContain(keke.instanceId);
    const delegated = confirmActiveEffectStep(
      started,
      P1,
      started.activeEffect!.id,
      keke.instanceId
    );
    expect(delegated.activeEffect).toMatchObject({
      abilityId: KEKE_ON_ENTER_PLACE_WAITING_ENERGY_ABILITY_ID,
      sourceCardId: keke.instanceId,
      selectableCardIds: [discard.instanceId],
    });
    expect(delegated.players[0].waitingRoom.cardIds).toContain(keke.instanceId);

    const done = confirmActiveEffectStep(
      delegated,
      P1,
      delegated.activeEffect!.id,
      discard.instanceId
    );
    expect(done.players[0].waitingRoom.cardIds).toEqual(
      expect.arrayContaining([keke.instanceId, discard.instanceId])
    );
    expect(done.players[0].energyZone.cardIds).toEqual([energyCard.instanceId]);
    expect(done.players[0].energyZone.cardStates.get(energyCard.instanceId)?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(
      done.actionHistory.some(
        (action) =>
          action.payload.abilityId === KEKE_ON_ENTER_PLACE_WAITING_ENERGY_ABILITY_ID &&
          action.payload.sourceCardId === keke.instanceId &&
          action.payload.step === 'PLACE_WAITING_ENERGY'
      )
    ).toBe(true);
  });

  it('delegates bp2-005 from waiting room, preserves the synthetic flag, and pays two energy before inspection', () => {
    const source = createCardInstance(member('PL!SP-bp2-006-R＋', 'Liella!', 10), P1, 'kinako-ren');
    const ren = createCardInstance(member('PL!SP-bp2-005-P', 'Liella!', 4), P1, 'delegated-ren');
    const energies = [energy('ren-energy-1'), energy('ren-energy-2')];
    const top = createCardInstance(member('top-liella'), P1, 'top-liella');
    const extraTopCards = Array.from({ length: 6 }, (_, index) =>
      createCardInstance(member(`top-extra-${index}`), P1, `top-extra-${index}`)
    );
    const game = activatedGame({
      source,
      hand: [ren],
      energies,
      mainDeck: [top, ...extraTopCards],
    });

    const started = activateCardAbility(
      game,
      P1,
      source.instanceId,
      SP_BP2_006_ACTIVATED_DISCARD_LOW_COST_LIELLA_MEMBER_ACTIVATE_ON_ENTER_ABILITY_ID
    );
    const delegated = confirmActiveEffectStep(
      started,
      P1,
      started.activeEffect!.id,
      ren.instanceId
    );
    expect(delegated.activeEffect).toMatchObject({
      abilityId: SP_BP2_005_ON_ENTER_PAY_TWO_ENERGY_LOOK_TOP_SEVEN_LIELLA_CARD_ABILITY_ID,
      sourceCardId: ren.instanceId,
      metadata: { delegatedOnEnterFromWaitingRoom: true },
    });
    expect(delegated.players[0].waitingRoom.cardIds).toContain(ren.instanceId);

    const inspected = confirmActiveEffectStep(
      delegated,
      P1,
      delegated.activeEffect!.id,
      undefined,
      undefined,
      undefined,
      'pay'
    );
    expect(inspected.activeEffect?.inspectionCardIds).toEqual([
      top.instanceId,
      ...extraTopCards.map((card) => card.instanceId),
    ]);
    for (const energyCard of energies) {
      expect(
        inspected.players[0].energyZone.cardStates.get(energyCard.instanceId)?.orientation
      ).toBe(OrientationState.WAITING);
    }
    expect(
      inspected.actionHistory.some(
        (action) =>
          action.type === 'PAY_COST' &&
          action.payload.abilityId ===
            SP_BP2_005_ON_ENTER_PAY_TWO_ENERGY_LOOK_TOP_SEVEN_LIELLA_CARD_ABILITY_ID &&
          action.payload.sourceCardId === ren.instanceId
      )
    ).toBe(true);
  });

  it('uses the discarded pb1-009 as the Q108 source and draws only for another 5yncri5e! member', () => {
    const source = createCardInstance(
      member('PL!SP-bp2-006-R＋', 'Liella!', 10),
      P1,
      'kinako-natsumi'
    );
    const natsumi = createCardInstance(
      member('PL!SP-pb1-009-R', 'Liella!', 4, '5yncri5e!'),
      P1,
      'delegated-natsumi'
    );
    const otherFiveyncrise = createCardInstance(
      member('other-fiveyncrise', 'Liella!', 2, '5yncri5e!'),
      P1,
      'other-fiveyncrise'
    );
    const drawCard = createCardInstance(member('draw-card'), P1, 'draw-card');
    const ruleSentinel = createCardInstance(member('draw-sentinel'), P1, 'draw-sentinel');
    const game = activatedGame({
      source,
      hand: [natsumi],
      stage: [{ card: otherFiveyncrise, slot: SlotPosition.LEFT }],
      mainDeck: [drawCard, ruleSentinel],
    });

    const started = activateCardAbility(
      game,
      P1,
      source.instanceId,
      SP_BP2_006_ACTIVATED_DISCARD_LOW_COST_LIELLA_MEMBER_ACTIVATE_ON_ENTER_ABILITY_ID
    );
    const done = confirmActiveEffectStep(started, P1, started.activeEffect!.id, natsumi.instanceId);
    expect(done.players[0].waitingRoom.cardIds).toContain(natsumi.instanceId);
    expect(done.players[0].hand.cardIds).toContain(drawCard.instanceId);
    expect(
      done.actionHistory.some(
        (action) =>
          action.payload.abilityId === SP_PB1_009_ON_ENTER_OTHER_FIVEYNCRISE_DRAW_ONE_ABILITY_ID &&
          action.payload.sourceCardId === natsumi.instanceId &&
          action.payload.step === 'ON_ENTER_OTHER_FIVEYNCRISE_DRAW_ONE'
      )
    ).toBe(true);
  });

  it('does not borrow Kinako left slot for bp1-002 under Q108', () => {
    const source = createCardInstance(
      member('PL!SP-bp2-006-R＋', 'Liella!', 10),
      P1,
      'left-kinako'
    );
    const keke = createCardInstance(member('PL!SP-bp1-002-P', 'Liella!', 4), P1, 'left-keke');
    const energies = [energy('keke-energy-1'), energy('keke-energy-2')];
    const drawCard = createCardInstance(member('must-not-draw'), P1, 'must-not-draw');
    const game = activatedGame({
      source,
      sourceSlot: SlotPosition.LEFT,
      hand: [keke],
      energies,
      mainDeck: [drawCard],
    });

    const started = activateCardAbility(
      game,
      P1,
      source.instanceId,
      SP_BP2_006_ACTIVATED_DISCARD_LOW_COST_LIELLA_MEMBER_ACTIVATE_ON_ENTER_ABILITY_ID
    );
    const done = confirmActiveEffectStep(started, P1, started.activeEffect!.id, keke.instanceId);
    expect(done.activeEffect).toBeNull();
    expect(done.players[0].waitingRoom.cardIds).toContain(keke.instanceId);
    expect(done.players[0].hand.cardIds).not.toContain(drawCard.instanceId);
    expect(done.players[0].mainDeck.cardIds).toContain(drawCard.instanceId);
    for (const energyCard of energies) {
      expect(done.players[0].energyZone.cardStates.get(energyCard.instanceId)?.orientation).toBe(
        OrientationState.ACTIVE
      );
    }
    expect(
      done.actionHistory.some(
        (action) =>
          action.type === 'PAY_COST' &&
          action.payload.abilityId === SP_BP1_002_ON_ENTER_LEFT_PAY_TWO_ENERGY_DRAW_TWO_ABILITY_ID
      )
    ).toBe(false);
  });

  it('does not offer Q159 self-costs, self-position change, or Q240 center-source effects', () => {
    const source = createCardInstance(
      member('PL!SP-bp2-006-R＋', 'Liella!', 10),
      P1,
      'kinako-deny'
    );
    const allowed = createCardInstance(member('PL!SP-PR-004-PR', 'Liella!', 4), P1, 'allowed');
    const denied = [
      createCardInstance(member('PL!SP-bp4-002-R', 'Liella!', 4), P1, 'q159-self-wait'),
      createCardInstance(member('PL!SP-bp5-008-N', 'Liella!', 4), P1, 'q159-wait-discard'),
      createCardInstance(member('PL!SP-bp4-013-R', 'Liella!', 4), P1, 'self-position'),
      createCardInstance(member('PL!SP-bp5-015-N', 'Liella!', 4), P1, 'q240-center'),
    ];
    const game = activatedGame({ source, hand: [allowed, ...denied] });

    const started = activateCardAbility(
      game,
      P1,
      source.instanceId,
      SP_BP2_006_ACTIVATED_DISCARD_LOW_COST_LIELLA_MEMBER_ACTIVATE_ON_ENTER_ABILITY_ID
    );
    expect(started.activeEffect?.selectableCardIds).toContain(allowed.instanceId);
    for (const card of denied) {
      expect(started.activeEffect?.selectableCardIds).not.toContain(card.instanceId);
    }
  });
});

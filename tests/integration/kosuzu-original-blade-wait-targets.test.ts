import { describe, expect, it } from 'vitest';
import {
  confirmActiveEffectStep,
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  N_SD2_013_LIVE_START_ONLY_NIJIGASAKI_WAIT_LOW_PRINTED_BLADE_OPPONENT_ABILITY_ID,
  N_SD2_013_ON_ENTER_ONLY_NIJIGASAKI_WAIT_LOW_PRINTED_BLADE_OPPONENT_ABILITY_ID,
  PL_PB1_009_ON_ENTER_WAIT_OPPONENT_ORIGINAL_BLADE_ONE_ABILITY_ID,
  SP_BP7_009_LIVE_START_WAIT_LOW_PRINTED_BLADE_OPPONENT_ABILITY_ID,
  SP_PB2_009_LIVE_START_WAIT_LIELLA_MEMBER_WAIT_OPPONENT_LOWER_PRINTED_BLADE_ABILITY_ID,
  SP_PB2_009_ON_ENTER_WAIT_LIELLA_MEMBER_WAIT_OPPONENT_LOWER_PRINTED_BLADE_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import {
  moveMemberBetweenSlots,
  playMembersFromWaitingRoomToEmptySlots,
} from '../../src/application/effects/member-state';
import type { MemberCardData } from '../../src/domain/entities/card';
import {
  getPlayerById,
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import { addCardToZone, placeCardInSlot, removeCardFromSlot } from '../../src/domain/entities/zone';
import { addLiveModifier } from '../../src/domain/rules/live-modifiers';
import { addMemberWaitProtectionUntilLiveEnd } from '../../src/domain/rules/member-wait-protections';
import {
  FaceState,
  OrientationState,
  SlotPosition,
  TriggerCondition,
} from '../../src/shared/types/enums';
import {
  choose,
  gameWithCards,
  member,
  pending,
  P1,
  P2,
} from '../helpers/card-effect-zone-fixture';
import { getNovember27MemberData } from '../helpers/november-27-draft-effects';
import { continuePublicEffectChoiceForTest } from '../helpers/public-effect-choice';

const { CENTER, LEFT } = SlotPosition;
const { ACTIVE, WAITING } = OrientationState;

function makeGame(
  sourceData: Partial<MemberCardData>,
  payer?: ReturnType<typeof member>
): GameState {
  const source = member('source', sourceData);
  const kosuzu = member('kosuzu', getNovember27MemberData('PL!HS-PR-044'), P2);
  const ally = member('cost-12-ally', { blade: 6, cost: 12 }, P2);
  const game = gameWithCards([source, kosuzu, ally, ...(payer ? [payer] : [])]);
  const stage = (state: GameState, card: typeof source, slot: SlotPosition) =>
    updatePlayer(state, card.ownerId, (player) => ({
      ...player,
      memberSlots: placeCardInSlot(player.memberSlots, slot, card.instanceId, {
        face: FaceState.FACE_UP,
        orientation: ACTIVE,
      }),
    }));
  const staged = stage(stage(stage(game, source, CENTER), kosuzu, LEFT), ally, CENTER);
  return payer ? stage(staged, payer, LEFT) : staged;
}

function qualifyKosuzu(game: GameState): GameState {
  return addLiveModifier(game, {
    kind: 'MEMBER_COST',
    playerId: P2,
    memberCardId: 'cost-12-ally',
    countDelta: 1,
  });
}

function disqualifyKosuzu(game: GameState): GameState {
  return addLiveModifier(game, {
    kind: 'MEMBER_COST_SET',
    playerId: P2,
    memberCardId: 'cost-12-ally',
    setTo: 12,
  });
}

function addOrdinaryBlade(game: GameState): GameState {
  return addLiveModifier(game, {
    kind: 'BLADE',
    target: 'SOURCE_MEMBER',
    sourceCardId: 'kosuzu',
    playerId: P2,
    countDelta: 2,
  });
}

function start(game: GameState, abilityId: string, timing: TriggerCondition): GameState {
  return resolvePendingCardEffects({
    ...game,
    pendingAbilities: [{ ...pending(abilityId, 'source', timing), sourceSlot: CENTER }],
  }).gameState;
}

function startFromMove(game: GameState): GameState {
  const moved = moveMemberBetweenSlots(game, P1, 'source', LEFT)!;
  return resolvePendingCardEffects(
    enqueueTriggeredCardEffects(moved.gameState, [TriggerCondition.ON_MEMBER_SLOT_MOVED])
  ).gameState;
}

function orientation(game: GameState, playerId: string, cardId: string) {
  return getPlayerById(game, playerId)?.memberSlots.cardStates.get(cardId)?.orientation;
}

function changedMemberIds(game: GameState) {
  return game.eventLog.flatMap(({ event }) =>
    event.eventType === TriggerCondition.ON_MEMBER_STATE_CHANGED ? [event.cardInstanceId] : []
  );
}

function reenterKosuzu(game: GameState): GameState {
  const afterDeparture = updatePlayer(game, P2, (player) => ({
    ...player,
    memberSlots: removeCardFromSlot(player.memberSlots, LEFT),
    waitingRoom: addCardToZone(player.waitingRoom, 'kosuzu'),
  }));
  return playMembersFromWaitingRoomToEmptySlots(afterDeparture, P2, [
    { cardId: 'kosuzu', toSlot: LEFT },
  ])!.gameState;
}

describe('Kosuzu original BLADE and opponent wait effects', () => {
  it.each([
    [
      'Nico on enter',
      'PL!-pb1-009-R',
      PL_PB1_009_ON_ENTER_WAIT_OPPONENT_ORIGINAL_BLADE_ONE_ABILITY_ID,
      TriggerCondition.ON_ENTER_STAGE,
    ],
    [
      'Natsumi BP7 LIVE start',
      'PL!SP-bp7-009-R',
      SP_BP7_009_LIVE_START_WAIT_LOW_PRINTED_BLADE_OPPONENT_ABILITY_ID,
      TriggerCondition.ON_LIVE_START,
    ],
    [
      'Ayumu on enter',
      'PL!N-sd2-013-SD2',
      N_SD2_013_ON_ENTER_ONLY_NIJIGASAKI_WAIT_LOW_PRINTED_BLADE_OPPONENT_ABILITY_ID,
      TriggerCondition.ON_ENTER_STAGE,
    ],
    [
      'Ayumu LIVE start',
      'PL!N-sd2-013-SD2',
      N_SD2_013_LIVE_START_ONLY_NIJIGASAKI_WAIT_LOW_PRINTED_BLADE_OPPONENT_ABILITY_ID,
      TriggerCondition.ON_LIVE_START,
    ],
  ] as const)(
    '%s excludes original 3 and revalidates the submitted card',
    (_label, cardCode, abilityId, timing) => {
      const game = addOrdinaryBlade(makeGame({ cardCode, groupNames: ['虹ヶ咲'] }));
      const qualified = qualifyKosuzu(game);
      expect(start(qualified, abilityId, timing).activeEffect).toBeNull();

      const unqualified = start(disqualifyKosuzu(qualified), abilityId, timing);
      expect(unqualified.activeEffect?.selectableCardIds).toEqual(['kosuzu']);
      expect(changedMemberIds(choose(unqualified, 'kosuzu'))).toEqual(['kosuzu']);

      const activeEffect = unqualified.activeEffect!;
      const oldSave = {
        ...unqualified,
        activeEffect: {
          ...activeEffect,
          metadata: { ...activeEffect.metadata, targetLifecycles: undefined },
        },
      };
      expect(changedMemberIds(choose(oldSave, 'kosuzu'))).toEqual(['kosuzu']);

      const stale = choose(qualifyKosuzu(start(game, abilityId, timing)), 'kosuzu');
      expect(stale.activeEffect).toBeNull();
      expect(orientation(stale, P2, 'kosuzu')).toBe(ACTIVE);
      expect(changedMemberIds(stale)).toEqual([]);

      const reentered = choose(reenterKosuzu(unqualified), 'kosuzu');
      expect(reentered.activeEffect).toBeNull();
      expect(orientation(reentered, P2, 'kosuzu')).toBe(ACTIVE);
      expect(changedMemberIds(reentered)).toEqual([]);
    }
  );

  it('Seira rechecks original BLADE after a real stage move opens the target choice', () => {
    const game = addOrdinaryBlade(makeGame({ cardCode: 'PL!S-bp5-111-R' }));
    expect(startFromMove(qualifyKosuzu(game)).activeEffect).toBeNull();
    const waiting = startFromMove(game);
    expect(waiting.activeEffect?.selectableCardIds).toEqual(['kosuzu']);
    expect(changedMemberIds(choose(waiting, 'kosuzu'))).toEqual(['kosuzu']);
    const stale = choose(qualifyKosuzu(waiting), 'kosuzu');
    expect(stale.activeEffect).toBeNull();
    expect(orientation(stale, P2, 'kosuzu')).toBe(ACTIVE);
    expect(changedMemberIds(stale)).toEqual([]);
  });

  it('Tomari omits the wait option and revalidates at reveal and target submission', () => {
    const game = addOrdinaryBlade(makeGame({ cardCode: 'PL!SP-pb2-011-R' }));
    const qualified = startFromMove(qualifyKosuzu(game));
    expect(qualified.activeEffect?.selectableOptions?.map((option) => option.id)).toEqual([
      'gain-blade',
      'draw',
    ]);
    const options = startFromMove(game);
    const reveal = confirmActiveEffectStep(
      options,
      P1,
      options.activeEffect!.id,
      null,
      null,
      false,
      'wait-opponent'
    );
    expect(continuePublicEffectChoiceForTest(qualifyKosuzu(reveal), P1).activeEffect).toBeNull();

    const target = continuePublicEffectChoiceForTest(reveal, P1);
    expect(target.activeEffect?.selectableCardIds).toEqual(['kosuzu']);
    expect(changedMemberIds(choose(target, 'kosuzu'))).toEqual(['kosuzu']);
    const stale = choose(qualifyKosuzu(target), 'kosuzu');
    expect(stale.activeEffect).toBeNull();
    expect(orientation(stale, P2, 'kosuzu')).toBe(ACTIVE);
    expect(changedMemberIds(stale)).toEqual([]);
  });

  const natsumi = { cardCode: 'PL!SP-pb2-009-R', groupNames: ['Liella!'] };
  const payer = member('liella-payer', { groupNames: ['Liella!'], blade: 4 });

  it.each([
    [
      SP_PB2_009_ON_ENTER_WAIT_LIELLA_MEMBER_WAIT_OPPONENT_LOWER_PRINTED_BLADE_ABILITY_ID,
      TriggerCondition.ON_ENTER_STAGE,
    ],
    [
      SP_PB2_009_LIVE_START_WAIT_LIELLA_MEMBER_WAIT_OPPONENT_LOWER_PRINTED_BLADE_ABILITY_ID,
      TriggerCondition.ON_LIVE_START,
    ],
  ] as const)('Natsumi pays, then compares original BLADE at %s', (abilityId, timing) => {
    const game = addOrdinaryBlade(makeGame(natsumi, payer));
    const qualified = qualifyKosuzu(game);
    const cost = start(qualified, abilityId, timing);
    expect(cost.activeEffect?.selectableCardIds).toContain(payer.instanceId);
    const noTarget = choose(cost, payer.instanceId);
    expect(noTarget.activeEffect).toBeNull();
    expect(orientation(noTarget, P1, payer.instanceId)).toBe(WAITING);
    expect(orientation(noTarget, P2, 'kosuzu')).toBe(ACTIVE);
    expect(changedMemberIds(noTarget)).toEqual([payer.instanceId]);

    const paid = choose(start(disqualifyKosuzu(qualified), abilityId, timing), payer.instanceId);
    expect(paid.activeEffect?.selectableCardIds).toEqual(['kosuzu']);
    expect(changedMemberIds(choose(paid, 'kosuzu'))).toEqual([payer.instanceId, 'kosuzu']);
    const stale = choose(
      qualifyKosuzu(choose(start(game, abilityId, timing), payer.instanceId)),
      'kosuzu'
    );
    expect(stale.activeEffect).toBeNull();
    expect(orientation(stale, P2, 'kosuzu')).toBe(ACTIVE);
    expect(changedMemberIds(stale)).toEqual([payer.instanceId]);
  });

  it('Natsumi excludes a protected opponent and discards a target that leaves and re-enters', () => {
    const abilityId =
      SP_PB2_009_ON_ENTER_WAIT_LIELLA_MEMBER_WAIT_OPPONENT_LOWER_PRINTED_BLADE_ABILITY_ID;
    const timing = TriggerCondition.ON_ENTER_STAGE;
    const game = makeGame(natsumi, payer);
    const protectedTarget = member('protected', { blade: 1, groupNames: ['Aqours'] }, P2);
    const protectedGame = addMemberWaitProtectionUntilLiveEnd(
      updatePlayer(registerCards(game, [protectedTarget]), P2, (player) => ({
        ...player,
        memberSlots: placeCardInSlot(
          player.memberSlots,
          SlotPosition.RIGHT,
          protectedTarget.instanceId,
          {
            face: FaceState.FACE_UP,
            orientation: ACTIVE,
          }
        ),
      })),
      { affectedPlayerId: P2, sourceCardId: 'cost-12-ally', abilityId: 'test-wait-protection' }
    );
    const paid = choose(start(protectedGame, abilityId, timing), payer.instanceId);
    expect(paid.activeEffect?.selectableCardIds).toEqual(['kosuzu']);
    const stale = choose(reenterKosuzu(paid), 'kosuzu');
    expect(stale.activeEffect).toBeNull();
    expect(orientation(stale, P2, 'kosuzu')).toBe(ACTIVE);
    expect(changedMemberIds(stale)).toEqual([payer.instanceId]);
  });

  it('Natsumi uses the original BLADE replacement of the Liella member that paid', () => {
    const abilityId =
      SP_PB2_009_ON_ENTER_WAIT_LIELLA_MEMBER_WAIT_OPPONENT_LOWER_PRINTED_BLADE_ABILITY_ID;
    const timing = TriggerCondition.ON_ENTER_STAGE;
    const game = qualifyKosuzu(makeGame(natsumi, payer));
    const cost = start(game, abilityId, timing);
    const fixed = addLiveModifier(cost, {
      kind: 'MEMBER_ORIGINAL_BLADE_REPLACEMENT',
      playerId: P1,
      memberCardId: payer.instanceId,
      sourceCardId: 'source',
      count: 5,
    });
    const paid = choose(fixed, payer.instanceId);
    expect(paid.activeEffect?.selectableCardIds).toEqual(['kosuzu']);
    expect(changedMemberIds(choose(paid, 'kosuzu'))).toEqual([payer.instanceId, 'kosuzu']);
  });
});

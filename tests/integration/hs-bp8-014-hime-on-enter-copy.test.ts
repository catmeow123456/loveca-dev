import { describe, expect, it } from 'vitest';
import {
  HS_BP8_014_ON_ENTER_OTHER_HASUNOSORA_DRAW_ONE_ABILITY_ID as HIME_ENTER,
  HS_BP8_014_LEAVE_STAGE_DISCARD_TWO_ABILITY_ID as HIME_LEAVE,
  HS_BP8_004_ACTIVATED_DISCARD_LOW_COST_HASUNOSORA_GAIN_ON_ENTER_ABILITY_ID as GINKO,
} from '../../src/application/card-effects/ability-ids';
import {
  activateCardAbility,
  confirmActiveEffectStep,
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  getCopyableOnEnterDefinitions,
  getCurrentTemporaryOnEnterAbilityGrants,
  getTemporaryOnEnterAbilityInvocation,
} from '../../src/application/card-effects/runtime/temporary-on-enter-ability-grants';
import { getStageMemberDelegatableOnEnterDefinitions } from '../../src/application/card-effects/runtime/delegatable-definitions';
import { getStageMemberLifecycleId } from '../../src/application/card-effects/runtime/ability-source-lifecycle';
import { sendStageMemberToWaitingRoomAndEnqueueLeaveStageTriggers } from '../../src/application/card-effects/runtime/leave-stage-triggers';
import { createCardInstance, type MemberCardData } from '../../src/domain/entities/card';
import {
  createGameState,
  emitGameEvent,
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import { createEnterStageEvent } from '../../src/domain/events/game-events';
import {
  CardType,
  FaceState,
  GamePhase,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
  ZoneType,
} from '../../src/shared/types/enums';
import {
  rehydrateAuthorityGameState,
  serializeReplayPayload,
} from '../../src/server/services/replay-payload-serialization';
import { GAME_STATE_SCHEMA_VERSION } from '../../src/server/services/replay-constants';
import { getOctober26CardData } from '../helpers/october-26-card-effects';
import { sourceCardFixture } from '../helpers/card-effect-zone-fixture';

const P1 = 'p1',
  P2 = 'p2';
type Mode = 'NATIVE' | 'HOST' | 'FREE';
function setup(mode: Mode, withOther: boolean) {
  const actor = createCardInstance(
    mode === 'NATIVE'
      ? getOctober26CardData('PL!HS-bp8-014-N')
      : sourceCardFixture('PL!HS-bp8-004-SEC')!,
    P1,
    'actor'
  );
  const template = createCardInstance(getOctober26CardData('PL!HS-bp8-014-N'), P1, 'template');
  const other = createCardInstance(
    {
      cardCode: 'SYNTHETIC-OTHER-HASUNOSORA',
      name: '合成莲之空成员',
      cardType: CardType.MEMBER,
      cost: 2,
      blade: 1,
      groupNames: ['蓮ノ空'],
      hearts: [{ color: HeartColor.PINK, count: 1 }],
    } as MemberCardData,
    P1,
    'other'
  );
  const deck = Array.from({ length: 8 }, (_, i) =>
    createCardInstance(
      {
        ...other.data,
        cardCode: `SYNTHETIC-DECK-${i}`,
        name: `合成卡组${i}`,
      },
      P1,
      `deck-${i}`
    )
  );
  let game = registerCards(createGameState('october-26-hime-copy-increment', P1, 'P1', P2, 'P2'), [
    actor,
    template,
    other,
    ...deck,
  ]);
  game = updatePlayer(game, P1, (p) => ({
    ...p,
    hand: { ...p.hand, cardIds: mode === 'NATIVE' ? [] : ['template'] },
    mainDeck: { ...p.mainDeck, cardIds: deck.map((c) => c.instanceId) },
    memberSlots: withOther
      ? placeCardInSlot(
          placeCardInSlot(p.memberSlots, SlotPosition.CENTER, 'actor', {
            face: FaceState.FACE_UP,
            orientation: OrientationState.ACTIVE,
          }),
          SlotPosition.LEFT,
          'other',
          { face: FaceState.FACE_UP, orientation: OrientationState.WAITING }
        )
      : placeCardInSlot(p.memberSlots, SlotPosition.CENTER, 'actor', {
          face: FaceState.FACE_UP,
          orientation: OrientationState.ACTIVE,
        }),
  }));
  game = { ...game, currentPhase: GamePhase.MAIN_PHASE, activePlayerIndex: 0 };
  return emitGameEvent(
    game,
    createEnterStageEvent('actor', ZoneType.HAND, SlotPosition.CENTER, P1, P1)
  );
}
function gainAndInvoke(game: GameState): GameState {
  const started = activateCardAbility(game, P1, 'actor', GINKO);
  expect(started.activeEffect?.abilityId).toBe(GINKO);
  return confirmActiveEffectStep(started, P1, started.activeEffect!.id, 'template');
}
function ordinaryDelegation(game: GameState): GameState {
  const invocation = getTemporaryOnEnterAbilityInvocation(game, P1, 'actor', HIME_ENTER)!;
  expect(invocation.waiveActivationCosts).toBe(false);
  const grant = getCurrentTemporaryOnEnterAbilityGrants(game, P1, 'actor')[0]!;
  expect(
    getStageMemberDelegatableOnEnterDefinitions('PL!HS-bp8-004-SEC', SlotPosition.CENTER, {
      game,
      controllerId: P1,
      sourceCardId: 'actor',
    }).map((d) => d.abilityId)
  ).toContain(HIME_ENTER);
  const event = game.eventLog.find(
    ({ event }) => event.eventType === TriggerCondition.ON_ENTER_STAGE
  )!.event;
  return resolvePendingCardEffects({
    ...game,
    pendingAbilities: [
      {
        id: 'ordinary-hime-delegation',
        abilityId: HIME_ENTER,
        sourceCardId: 'actor',
        sourceLifecycleId: getStageMemberLifecycleId(game, 'actor'),
        controllerId: P1,
        mandatory: true,
        timingId: TriggerCondition.ON_ENTER_STAGE,
        eventIds: [event.eventId],
        sourceSlot: SlotPosition.CENTER,
        onEnterInvocation: { ...invocation, grantId: grant.grantId },
      },
    ],
  }).gameState;
}
function roundtrip(game: GameState): GameState {
  return rehydrateAuthorityGameState(
    serializeReplayPayload(game, 'AUTHORITY_GAME_STATE', GAME_STATE_SCHEMA_VERSION)
  );
}

describe('October 26 incremental 姬芽 copying matrix (October 20 snapshot remains frozen)', () => {
  it('adds one eligible Hasunosora ON_ENTER source and never copies its AUTO discard paragraph', () => {
    const data = getOctober26CardData('PL!HS-bp8-014-N') as MemberCardData;
    expect(data.cost).toBe(2);
    expect(data.nameJp).toBe('安養寺姫芽');
    expect(getCopyableOnEnterDefinitions(data.cardCode).map((d) => d.abilityId)).toEqual([
      HIME_ENTER,
    ]);
    expect(getCopyableOnEnterDefinitions('PL!HS-bp8-014-SEC').map((d) => d.abilityId)).toEqual([
      HIME_ENTER,
    ]);
  });
  it.each(['NATIVE', 'HOST', 'FREE'] as const)(
    '%s draws one using the real recipient and another own stage member',
    (mode) => {
      let game = setup(mode, true);
      if (mode === 'NATIVE')
        game = resolvePendingCardEffects(
          enqueueTriggeredCardEffects(game, [TriggerCondition.ON_ENTER_STAGE])
        ).gameState;
      else {
        game = gainAndInvoke(game);
        expect(game.players[0].waitingRoom.cardIds).toContain('template');
        expect(getCurrentTemporaryOnEnterAbilityGrants(game, P1, 'actor')).toEqual([
          expect.objectContaining({
            abilityId: HIME_ENTER,
            definitionSourceCardCode: 'PL!HS-bp8-014-N',
            hostCardId: 'actor',
          }),
        ]);
        if (mode === 'HOST') game = ordinaryDelegation(roundtrip(game));
      }
      expect(game.players[0].hand.cardIds).toEqual(
        mode === 'HOST' ? ['deck-0', 'deck-1'] : ['deck-0']
      );
      const uses = game.actionHistory.filter(
        (a) =>
          a.payload.abilityId === HIME_ENTER &&
          a.payload.step === 'OTHER_HASUNOSORA_STAGE_MEMBER_DRAW_ONE'
      );
      expect(uses).toHaveLength(mode === 'HOST' ? 2 : 1);
      expect(uses.every((a) => a.payload.sourceCardId === 'actor')).toBe(true);
      expect(
        game.actionHistory.filter(
          (a) => a.type === 'PAY_COST' && a.payload.abilityId === HIME_ENTER
        )
      ).toEqual([]);
      expect(game.activeEffect).toBeNull();
      expect(game.pendingAbilities).toEqual([]);
    }
  );
  it.each(['NATIVE', 'HOST', 'FREE'] as const)(
    '%s never treats the recipient or the discarded template as another stage member',
    (mode) => {
      let game = setup(mode, false);
      if (mode === 'NATIVE')
        game = resolvePendingCardEffects(
          enqueueTriggeredCardEffects(game, [TriggerCondition.ON_ENTER_STAGE])
        ).gameState;
      else {
        game = gainAndInvoke(game);
        if (mode === 'HOST') game = ordinaryDelegation(roundtrip(game));
        expect(game.players[0].waitingRoom.cardIds).toEqual(['template']);
      }
      expect(game.players[0].hand.cardIds).toEqual([]);
      expect(game.players[0].mainDeck.cardIds).toHaveLength(8);
      expect(
        game.actionHistory.filter((a) => a.payload.abilityId === HIME_ENTER).at(-1)?.payload.step
      ).toBe('OTHER_STAGE_GROUP_MEMBER_CONDITION_NOT_MET');
      expect(game.pendingAbilities).toEqual([]);
    }
  );
  it('does not grant the donor AUTO paragraph when the Ginko recipient leaves', () => {
    const copied = gainAndInvoke(setup('FREE', true));
    const moved = sendStageMemberToWaitingRoomAndEnqueueLeaveStageTriggers(
      copied,
      P1,
      'actor',
      enqueueTriggeredCardEffects
    )!;
    expect(moved.gameState.pendingAbilities.filter((a) => a.abilityId === HIME_LEAVE)).toEqual([]);
    expect(moved.gameState.players[0].hand.cardIds).toEqual(['deck-0']);
    expect(getCurrentTemporaryOnEnterAbilityGrants(moved.gameState, P1, 'actor')).toEqual([]);
  });
});

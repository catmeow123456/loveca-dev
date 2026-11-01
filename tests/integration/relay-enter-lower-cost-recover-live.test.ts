import { describe, expect, it } from 'vitest';
import {
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
  confirmActiveEffectStep,
} from '../../src/application/card-effect-runner';
import { HS_BP8_011_ON_ENTER_LOWER_COST_RELAY_RECOVER_MIRACRA_LIVE_ABILITY_ID as ABILITY } from '../../src/application/card-effects/ability-ids';
import { sendStageMemberToWaitingRoomAndEnqueueLeaveStageTriggers } from '../../src/application/card-effects/runtime/leave-stage-triggers';
import {
  createCardInstance,
  createHeartRequirement,
  type LiveCardData,
  type MemberCardData,
} from '../../src/domain/entities/card';
import {
  createGameState,
  emitGameEvent,
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import {
  placeCardInSlot,
  removeCardFromSlot,
  removeCardFromZone,
} from '../../src/domain/entities/zone';
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
import { createOctober31DraftCard } from '../helpers/october-31-draft-effects';
import { confirmActiveEffectStepThroughPublicReveal } from '../helpers/public-card-selection-confirmation';

const P1 = 'p1',
  P2 = 'p2';
function setup(
  options: { cost?: number; relay?: boolean; target?: boolean; code?: string; unit?: string } = {}
) {
  const source = createOctober31DraftCard('PL!HS-bp8-011', P1, 'rurino');
  const replacement = createCardInstance(
    {
      cardCode: 'SYNTHETIC-RELAY',
      name: '任意小队换手者',
      cardType: CardType.MEMBER,
      cost: 20,
      blade: 1,
      hearts: [{ color: HeartColor.GREEN, count: 1 }],
      unitName: 'DOLLCHESTRA',
    } as MemberCardData,
    P1,
    'replacement'
  );
  const target = createCardInstance(
    {
      cardCode: 'SYNTHETIC-LIVE',
      name: 'MiraCra LIVE',
      cardType: CardType.LIVE,
      score: 2,
      unitName: options.unit ?? 'みらくらぱーく!',
      requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
    } as LiveCardData,
    P1,
    'target'
  );
  const wrong = createCardInstance(
    { ...target.data, cardCode: 'SYNTHETIC-WRONG', unitName: 'DOLLCHESTRA' } as LiveCardData,
    P1,
    'wrong'
  );
  let game = registerCards(createGameState('relay-recover-live', P1, 'P1', P2, 'P2'), [
    options.code ? { ...source, data: { ...source.data, cardCode: options.code } } : source,
    replacement,
    target,
    wrong,
  ]);
  game = updatePlayer(game, P1, (p) => ({
    ...p,
    memberSlots: placeCardInSlot(p.memberSlots, SlotPosition.CENTER, 'rurino', {
      face: FaceState.FACE_UP,
      orientation: OrientationState.ACTIVE,
    }),
    waitingRoom: {
      ...p.waitingRoom,
      cardIds:
        options.target === false ? ['replacement', 'wrong'] : ['replacement', 'target', 'wrong'],
    },
  }));
  game = { ...game, currentPhase: GamePhase.MAIN_PHASE, activePlayerIndex: 0 };
  const entry = createEnterStageEvent(
    'rurino',
    ZoneType.HAND,
    SlotPosition.CENTER,
    P1,
    P1,
    options.relay === false
      ? undefined
      : {
          relayReplacements: [
            { cardId: 'replacement', slot: SlotPosition.CENTER, effectiveCost: options.cost ?? 3 },
          ],
        }
  );
  return enqueueTriggeredCardEffects(
    emitGameEvent(game, entry),
    [TriggerCondition.ON_ENTER_STAGE],
    { enterStageEvents: [entry] }
  );
}
const resolve = (g: GameState) => resolvePendingCardEffects(g).gameState;
const recover = (g: GameState) =>
  confirmActiveEffectStepThroughPublicReveal(g, P1, g.activeEffect!.id, 'target');
const costModifier = (g: GameState, delta: number): GameState => ({
  ...g,
  liveResolution: {
    ...g.liveResolution,
    liveModifiers: [
      ...g.liveResolution.liveModifiers,
      {
        kind: 'MEMBER_COST',
        playerId: P1,
        memberCardId: 'rurino',
        countDelta: delta,
        sourceCardId: 'modifier',
        abilityId: 'synthetic-cost',
      },
    ],
  },
});

describe('lower-cost relay LIVE recovery family / PL!HS-bp8-011 费用4 大泽瑠璃乃', () => {
  it.each(['PL!HS-bp8-011-N', 'PL!HS-bp8-011-P', 'PL!HS-bp8-011-SEC'])(
    'uses historical replacement effective cost and any replacement unit for %s',
    (code) => {
      const queued = setup({ code });
      expect(queued.pendingAbilities.filter((a) => a.abilityId === ABILITY)).toHaveLength(1);
      let game = resolve(queued);
      expect(game.activeEffect?.selectableCardIds).toEqual(['target']);
      expect(game.activeEffect?.canSkipSelection).toBe(false);
      expect(confirmActiveEffectStep(game, P1, game.activeEffect!.id, null)).toBe(game);
      expect(confirmActiveEffectStep(game, P1, game.activeEffect!.id, 'wrong')).toBe(game);
      const id = game.activeEffect!.id;
      game = recover(game);
      expect(game.players[0].hand.cardIds).toEqual(['target']);
      expect(game.players[0].waitingRoom.cardIds).toEqual(['replacement', 'wrong']);
      expect(game.pendingAbilities).toEqual([]);
      expect(game.activeEffect).toBeNull();
      expect(
        game.eventLog.filter(
          ({ event }) =>
            event.eventType === TriggerCondition.ON_ENTER_HAND && event.cardInstanceId === 'target'
        )
      ).toHaveLength(1);
      expect(confirmActiveEffectStep(game, P1, id, 'target')).toBe(game);
    }
  );
  it.each([
    { relay: false },
    { cost: 4 },
    { cost: 5 },
    { target: false },
    { unit: 'Cerise Bouquet' },
  ])('consumes a nonmatching pending and continues for %j', (options) => {
    const game = resolve(setup(options));
    expect(game.activeEffect).toBeNull();
    expect(game.pendingAbilities).toEqual([]);
    expect(game.players[0].hand.cardIds).toEqual([]);
  });
  it('compares against the actual source effective cost at resolution', () => {
    const qualifies = resolve(costModifier(setup({ cost: 6 }), 3));
    expect(qualifies.activeEffect?.selectableCardIds).toEqual(['target']);
    const fails = resolve(costModifier(setup({ cost: 3 }), -1));
    expect(fails.activeEffect).toBeNull();
  });
  it('accepts any qualifying member in a multi-member relay', () => {
    let game = setup({ cost: 10 });
    const original = game.cardRegistry.get('replacement')!;
    game = registerCards(game, [{ ...original, instanceId: 'second-replacement' }]);
    game = {
      ...game,
      pendingAbilities: game.pendingAbilities.map((a) => ({
        ...a,
        metadata: {
          ...a.metadata,
          relayReplacements: [
            { cardId: 'replacement', effectiveCost: 10 },
            { cardId: 'second-replacement', effectiveCost: 2 },
          ],
        },
      })),
    };
    expect(resolve(game).activeEffect?.selectableCardIds).toEqual(['target']);
  });
  it('uses final effective cost after real departure and ignores a later re-entry of the same entity', () => {
    let game = costModifier(setup({ cost: 6 }), 3);
    game = sendStageMemberToWaitingRoomAndEnqueueLeaveStageTriggers(
      game,
      P1,
      'rurino',
      enqueueTriggeredCardEffects
    )!.gameState;
    game = { ...game, liveResolution: { ...game.liveResolution, liveModifiers: [] } };
    game = updatePlayer(game, P1, (p) => ({
      ...p,
      waitingRoom: removeCardFromZone(p.waitingRoom, 'rurino'),
      memberSlots: placeCardInSlot(p.memberSlots, SlotPosition.CENTER, 'rurino'),
    }));
    game = emitGameEvent(
      game,
      createEnterStageEvent('rurino', ZoneType.WAITING_ROOM, SlotPosition.CENTER, P1, P1)
    );
    game = costModifier(game, -3);
    game = resolve(game);
    expect(game.activeEffect?.selectableCardIds).toEqual(['target']);
    expect(recover(game).players[0].hand.cardIds).toEqual(['target']);
  });
  it('continues independent recovery when the source has left without re-entering', () => {
    let game = setup();
    game = sendStageMemberToWaitingRoomAndEnqueueLeaveStageTriggers(
      game,
      P1,
      'rurino',
      enqueueTriggeredCardEffects
    )!.gameState;
    game = resolve(game);
    expect(recover(game).players[0].hand.cardIds).toEqual(['target']);
  });
  it('terminates with an explicit diagnostic if an old source has no authoritative snapshot', () => {
    let game = setup();
    game = updatePlayer(game, P1, (p) => ({
      ...p,
      memberSlots: removeCardFromSlot(p.memberSlots, SlotPosition.CENTER),
    }));
    game = resolve(game);
    expect(game.activeEffect).toBeNull();
    expect(
      game.actionHistory.find(
        (a) =>
          a.payload.abilityId === ABILITY && a.payload.step === 'SOURCE_INFORMATION_UNAVAILABLE'
      )
    ).toBeDefined();
  });
  it('does not move a target that leaves during public display and resumes the pending pool', () => {
    let game = resolve(setup());
    const id = game.activeEffect!.id;
    game = confirmActiveEffectStep(game, P1, id, 'target');
    expect(game.players[0].waitingRoom.cardIds).toContain('target');
    game = updatePlayer(game, P1, (p) => ({
      ...p,
      waitingRoom: removeCardFromZone(p.waitingRoom, 'target'),
    }));
    game = confirmActiveEffectStep(game, P1, id);
    expect(game.activeEffect).toBeNull();
    expect(game.pendingAbilities).toEqual([]);
    expect(game.players[0].hand.cardIds).toEqual([]);
    expect(
      game.eventLog.filter(({ event }) => event.eventType === TriggerCondition.ON_ENTER_HAND)
    ).toHaveLength(0);
  });
});

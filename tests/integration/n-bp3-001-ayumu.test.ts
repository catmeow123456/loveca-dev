import { describe, expect, it } from 'vitest';
import type { EnergyCardData, MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import { createGameState, registerCards, updatePlayer, type GameState } from '../../src/domain/entities/game';
import { addMemberBelowMember, placeCardInSlot, removeCardFromSlot } from '../../src/domain/entities/zone';
import { confirmActiveEffectStep, resolvePendingCardEffects } from '../../src/application/card-effect-runner';
import { PL_N_BP3_001_LIVE_START_STACK_ENERGY_DRAW_STAGE_GAIN_TWO_BLADE_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import { getMemberEffectiveBladeCount } from '../../src/domain/rules/live-modifiers';
import { CardType, FaceState, HeartColor, OrientationState, SlotPosition, TriggerCondition } from '../../src/shared/types/enums';

const P1 = 'p1'; const P2 = 'p2';
const member = (code: string): MemberCardData => ({ cardCode: code, name: code, cardType: CardType.MEMBER, cost: 1, blade: 1, hearts: [createHeartIcon(HeartColor.PINK, 1)] });
const energy = (code: string): EnergyCardData => ({ cardCode: code, name: code, cardType: CardType.ENERGY });

function setup(): { game: GameState; ids: Record<string, string> } {
  const cards = [
    createCardInstance(member('PL!N-bp3-001-R＋'), P1, 'source'),
    createCardInstance(member('ALLY-L'), P1, 'ally-left'), createCardInstance(member('ALLY-R'), P1, 'ally-right'),
    createCardInstance(member('DRAW'), P1, 'draw'), createCardInstance(energy('EA'), P1, 'active-energy'),
    createCardInstance(energy('EW'), P1, 'waiting-energy'),
    createCardInstance(member('BELOW'), P1, 'member-below'), createCardInstance(member('DEPARTED'), P1, 'departed'),
    createCardInstance(member('OPPONENT'), P2, 'opponent'),
  ];
  let game = registerCards(createGameState('bp3-001', P1, 'P1', P2, 'P2'), cards);
  game = updatePlayer(game, P1, (p) => ({ ...p,
    memberSlots: addMemberBelowMember(placeCardInSlot(placeCardInSlot(placeCardInSlot(p.memberSlots, SlotPosition.CENTER, 'source'), SlotPosition.LEFT, 'ally-left', { orientation: OrientationState.WAITING, face: FaceState.FACE_UP }), SlotPosition.RIGHT, 'ally-right'), SlotPosition.CENTER, 'member-below'),
    mainDeck: { ...p.mainDeck, cardIds: ['draw'] },
    energyZone: { ...p.energyZone, cardIds: ['active-energy', 'waiting-energy'], cardStates: new Map([
      ['active-energy', { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
      ['waiting-energy', { orientation: OrientationState.WAITING, face: FaceState.FACE_UP }],
    ]) },
  }));
  game = updatePlayer(game, P2, (p) => ({ ...p, memberSlots: placeCardInSlot(p.memberSlots, SlotPosition.CENTER, 'opponent') }));
  game = { ...game, pendingAbilities: [{ id: 'pending', abilityId: PL_N_BP3_001_LIVE_START_STACK_ENERGY_DRAW_STAGE_GAIN_TWO_BLADE_ABILITY_ID, sourceCardId: 'source', controllerId: P1, mandatory: true, timingId: TriggerCondition.ON_LIVE_START, eventIds: ['event'], sourceSlot: SlotPosition.CENTER }] };
  return { game, ids: { source: 'source', left: 'ally-left', right: 'ally-right' } };
}
const open = (game: GameState) => resolvePendingCardEffects(game).gameState;
const choose = (game: GameState, option: string | null) => confirmActiveEffectStep(game, P1, game.activeEffect!.id, null, null, undefined, option);

describe('PL!N-bp3-001 Ayumu', () => {
  it('uses a real optional window, stacks the later WAITING energy, draws, and gives every own main-stage member BLADE +2', () => {
    const { game, ids } = setup(); const started = open(game);
    expect(started.activeEffect?.selectableOptions).toEqual([{ id: 'stack-energy', label: '将1张能量放到此成员下方' }]);
    expect(started.activeEffect?.skipSelectionLabel).toBe('不发动');
    const done = choose(started, 'stack-energy'); const p = done.players[0]!;
    expect(p.memberSlots.energyBelow[SlotPosition.CENTER]).toEqual(['waiting-energy']);
    expect(p.energyZone.cardIds).toEqual(['active-energy']); expect(p.hand.cardIds).toEqual(['draw']);
    for (const id of Object.values(ids)) expect(getMemberEffectiveBladeCount(done, P1, id)).toBe(3);
    expect(getMemberEffectiveBladeCount(done, P1, 'member-below')).toBe(1);
    expect(getMemberEffectiveBladeCount(done, P1, 'departed')).toBe(1);
    expect(getMemberEffectiveBladeCount(done, P2, 'opponent')).toBe(1);
    const payload = done.actionHistory.at(-1)?.payload;
    expect(payload).toMatchObject({ stackedEnergyCardIds: ['waiting-energy'], targetMemberCardIds: ['ally-left', 'source', 'ally-right'], appliedTargetMemberCardIds: ['ally-left', 'source', 'ally-right'], bladeBonusPerMember: 2 });
    expect(
      done.eventLog.some(
        (entry) =>
          entry.event.eventType === TriggerCondition.ON_ENERGY_PLACED_BY_CARD_EFFECT
      )
    ).toBe(false);
  });

  it('declines without payment/reward and keeps illegal input unchanged', () => {
    const started = open(setup().game);
    expect(choose(started, 'illegal')).toBe(started);
    const declined = choose(started, null);
    expect(declined.players[0]!.energyZone.cardIds).toEqual(['active-energy', 'waiting-energy']);
    expect(declined.players[0]!.hand.cardIds).toEqual([]);
    expect(declined.actionHistory.some((action) => action.type === 'PAY_COST')).toBe(false);
  });

  it('consumes safely when source leaves before confirmation', () => {
    const started = open(setup().game);
    const stale = updatePlayer(started, P1, (p) => ({ ...p, memberSlots: removeCardFromSlot(p.memberSlots, SlotPosition.CENTER) }));
    const done = choose(stale, 'stack-energy');
    expect(done.activeEffect).toBeNull(); expect(done.players[0]!.energyZone.cardIds).toHaveLength(2);
    expect(done.actionHistory.some((action) => action.type === 'PAY_COST')).toBe(false);
  });

  it('does not open an unpayable window and safely consumes energy that becomes stale', () => {
    const empty = updatePlayer(setup().game, P1, (p) => ({ ...p, energyZone: { ...p.energyZone, cardIds: [], cardStates: new Map() } }));
    expect(open(empty).activeEffect).toBeNull();
    const started = open(setup().game);
    const stale = updatePlayer(started, P1, (p) => ({ ...p, energyZone: { ...p.energyZone, cardIds: [], cardStates: new Map() } }));
    const done = choose(stale, 'stack-energy');
    expect(done.activeEffect).toBeNull(); expect(done.players[0]!.hand.cardIds).toEqual([]);
    expect(done.actionHistory.some((action) => action.type === 'PAY_COST')).toBe(false);
  });

  it('keeps ordered resolution in the real interaction window and continues later pending effects', () => {
    const base = setup().game;
    const game = { ...base, pendingAbilities: [base.pendingAbilities[0]!, { ...base.pendingAbilities[0]!, id: 'pending-2' }] };
    const order = open(game); expect(order.activeEffect?.canResolveInOrder).toBe(true);
    const started = confirmActiveEffectStep(order, P1, order.activeEffect!.id, null, null, true);
    expect(started.activeEffect).toMatchObject({ abilityId: PL_N_BP3_001_LIVE_START_STACK_ENERGY_DRAW_STAGE_GAIN_TWO_BLADE_ABILITY_ID, metadata: expect.objectContaining({ orderedResolution: true }) });
    const continued = choose(started, 'stack-energy');
    expect(continued.activeEffect).toMatchObject({ id: 'pending-2', metadata: expect.objectContaining({ orderedResolution: true }) });
    const done = choose(continued, null); expect(done.pendingAbilities).toEqual([]); expect(done.activeEffect).toBeNull();
  });
});

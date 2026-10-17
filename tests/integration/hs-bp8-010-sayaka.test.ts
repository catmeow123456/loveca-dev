import { describe, expect, it } from 'vitest';
import {
  createCardInstance,
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
import { placeCardInSlot, removeCardFromSlot } from '../../src/domain/entities/zone';
import { addLiveModifier } from '../../src/domain/rules/live-modifiers';
import { resolvePendingCardEffects } from '../../src/application/card-effect-runner';
import { createGameSession, type GameSession } from '../../src/application/game-session';
import { createConfirmEffectStepCommand } from '../../src/application/game-commands';
import {
  HS_BP8_010_LIVE_START_DISCARD_HASUNOSORA_COST_TWENTY_FIVE_RECOVER_DOLLCHESTRA_LIVE_ABILITY_ID as ABILITY,
  HS_PB1_003_AUTO_HAND_TO_WAITING_GAIN_HEART_BLADE_ABILITY_ID as RURINO_ABILITY,
} from '../../src/application/card-effects/ability-ids';
import {
  CardType,
  HeartColor,
  SlotPosition,
  TriggerCondition,
  ZoneType,
} from '../../src/shared/types/enums';
import { confirmPublicSelectionIfNeeded } from '../helpers/public-card-selection-confirmation';

function member(code: string, cost: number, group = '蓮ノ空'): MemberCardData {
  return {
    cardCode: code,
    name: code,
    cardType: CardType.MEMBER,
    groupNames: [group],
    cost,
    blade: 1,
    hearts: [],
  };
}
function live(unit = 'DOLLCHESTRA'): LiveCardData {
  return {
    cardCode: `LIVE-${unit}`,
    name: unit,
    cardType: CardType.LIVE,
    groupNames: ['蓮ノ空'],
    unitName: unit,
    score: 2,
    requirements: createHeartRequirement({ [HeartColor.BLUE]: 1 }),
  };
}
function setState(session: GameSession, state: GameState) {
  (session as unknown as { authorityState: GameState }).authorityState = state;
}
function choose(session: GameSession, id: string | null, advance = true) {
  const result = session.executeCommand(
    createConfirmEffectStepCommand(
      'p1',
      session.state!.activeEffect!.id,
      session.state!.activeEffect!.metadata?.confirmOnlyPendingAbility ? undefined : id
    )
  );
  if (result.success && advance) confirmPublicSelectionIfNeeded(session);
  return result;
}
function setup(
  options: {
    cost?: number;
    group?: string;
    code?: string;
    targets?: CardInstance[];
    discardLive?: boolean;
  } = {}
) {
  const source = createCardInstance(member(options.code ?? 'PL!HS-bp8-010-N', 4), 'p1', 'sayaka');
  const other = createCardInstance(
    member('OTHER', options.cost ?? 21, options.group),
    'p1',
    'other'
  );
  const discard = createCardInstance(
    options.discardLive ? live() : member('DISCARD', 9),
    'p1',
    'discard'
  );
  const targets = options.targets ?? [createCardInstance(live(), 'p1', 'target')];
  let game = registerCards(createGameState('hs-bp8-010', 'p1', 'P1', 'p2', 'P2'), [
    source,
    other,
    discard,
    ...targets,
  ]);
  game = updatePlayer(game, 'p1', (p) => ({
    ...p,
    memberSlots: placeCardInSlot(
      placeCardInSlot(p.memberSlots, SlotPosition.CENTER, source.instanceId),
      SlotPosition.LEFT,
      other.instanceId
    ),
    hand: { ...p.hand, cardIds: [discard.instanceId] },
    waitingRoom: { ...p.waitingRoom, cardIds: targets.map((c) => c.instanceId) },
  }));
  game = {
    ...game,
    pendingAbilities: [
      {
        id: 'sayaka-pending',
        abilityId: ABILITY,
        controllerId: 'p1',
        sourceCardId: source.instanceId,
        sourceSlot: SlotPosition.CENTER,
        mandatory: true,
        timingId: TriggerCondition.ON_LIVE_START,
        eventIds: [],
      },
    ],
  };
  const session = createGameSession();
  session.createGame('hs-bp8-010-session', 'p1', 'P1', 'p2', 'P2');
  setState(session, resolvePendingCardEffects(game).gameState);
  return { session, source, other, discard, targets, initialGame: game };
}

describe('PL!HS-bp8-010 费用4「村野沙耶香」', () => {
  it.each(['N', 'R', 'P', 'SEC'])(
    'covers %s, pays first, then requires one DOLLCHESTRA LIVE',
    (rare) => {
      const { session, discard, targets } = setup({ code: `PL!HS-bp8-010-${rare}` });
      expect(choose(session, discard.instanceId).success).toBe(true);
      expect(session.state!.activeEffect?.canSkipSelection).toBe(false);
      expect(choose(session, targets[0]!.instanceId, false).success).toBe(true);
      expect(session.state!.players[0].waitingRoom.cardIds).toContain(targets[0]!.instanceId);
      confirmPublicSelectionIfNeeded(session);
      expect(session.state!.players[0].hand.cardIds).toEqual([targets[0]!.instanceId]);
      expect(session.state!.players[0].waitingRoom.cardIds).toContain(discard.instanceId);
      expect(
        session.state!.eventLog.filter(
          (e) =>
            e.event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM &&
            e.event.fromZone === ZoneType.HAND
        )
      ).toHaveLength(1);
    }
  );

  it('still pays at total cost 24 and when only non-Hasunosora stage cost would reach 25', () => {
    for (const options of [{ cost: 20 }, { cost: 30, group: 'Aqours' }]) {
      const { session, discard } = setup(options);
      expect(choose(session, discard.instanceId).success).toBe(true);
      expect(session.state!.players[0].waitingRoom.cardIds).toContain(discard.instanceId);
      expect(session.state!.players[0].hand.cardIds).toEqual([]);
      expect(session.state!.activeEffect).toBeNull();
    }
  });

  it('evaluates current effective cost only after payment', () => {
    const { session, other, discard, targets } = setup({ cost: 20 });
    setState(
      session,
      addLiveModifier(session.state!, {
        kind: 'MEMBER_COST',
        memberCardId: other.instanceId,
        playerId: 'p1',
        sourceCardId: other.instanceId,
        abilityId: 'test:cost',
        countDelta: 1,
      })
    );
    choose(session, discard.instanceId);
    expect(session.state!.activeEffect?.selectableCardIds).toEqual([targets[0]!.instanceId]);
  });

  it('can recover the same DOLLCHESTRA LIVE just discarded as cost', () => {
    const { session, discard } = setup({ targets: [], discardLive: true });
    choose(session, discard.instanceId);
    expect(session.state!.activeEffect?.selectableCardIds).toEqual([discard.instanceId]);
    choose(session, discard.instanceId);
    expect(session.state!.players[0].hand.cardIds).toEqual([discard.instanceId]);
  });

  it('keeps paid cost when no target exists and allows declining without paying', () => {
    const empty = setup({ targets: [] });
    choose(empty.session, empty.discard.instanceId);
    expect(empty.session.state!.players[0].waitingRoom.cardIds).toEqual([empty.discard.instanceId]);
    expect(empty.session.state!.activeEffect).toBeNull();
    const declined = setup();
    choose(declined.session, null);
    expect(declined.session.state!.players[0].hand.cardIds).toEqual([declined.discard.instanceId]);
  });

  it('filters by LIVE type, structured unit and ownership', () => {
    const targets = [
      createCardInstance(live(), 'p1', 'valid'),
      createCardInstance(live('スリーズブーケ'), 'p1', 'wrong-unit'),
      createCardInstance({ ...member('MEMBER', 1), unitName: 'DOLLCHESTRA' }, 'p1', 'member'),
      createCardInstance(live(), 'p2', 'opponent'),
    ];
    const { session, discard } = setup({ targets });
    choose(session, discard.instanceId);
    expect(session.state!.activeEffect?.selectableCardIds).toEqual(['valid']);
  });

  it('rejects illegal fee input and revalidates a selected unit after public display', () => {
    const { session, discard, targets } = setup();
    expect(choose(session, 'not-in-hand').success).toBe(false);
    choose(session, discard.instanceId);
    choose(session, targets[0]!.instanceId, false);
    const target = session.state!.cardRegistry.get(targets[0]!.instanceId)!;
    setState(
      session,
      registerCards(session.state!, [{ ...target, data: { ...target.data, unitName: 'other' } }])
    );
    confirmPublicSelectionIfNeeded(session);
    expect(session.state!.players[0].hand.cardIds).toEqual([]);
    expect(session.state!.players[0].waitingRoom.cardIds).toContain(discard.instanceId);
    expect(session.state!.activeEffect).toBeNull();
  });
});

it.each(['single', 'manual', 'ordered'])(
  'confirms no-hand Sayaka in %s mode while ordered resolution continues automatically',
  (mode) => {
    const { session, initialGame } = setup();
    let game = updatePlayer(initialGame, 'p1', (p) => ({
      ...p,
      hand: { ...p.hand, cardIds: [] },
      mainDeck: { ...p.mainDeck, cardIds: ['discard'] },
    }));
    if (mode !== 'single') {
      const second = createCardInstance(member('PL!HS-bp8-010-N', 4), 'p1', 'second-sayaka');
      game = registerCards(game, [second]);
      game = updatePlayer(game, 'p1', (p) => ({
        ...p,
        memberSlots: placeCardInSlot(p.memberSlots, SlotPosition.RIGHT, second.instanceId),
      }));
      game = {
        ...game,
        pendingAbilities: [
          ...game.pendingAbilities,
          {
            ...game.pendingAbilities[0]!,
            id: 'second-pending',
            sourceCardId: second.instanceId,
            sourceSlot: SlotPosition.RIGHT,
          },
        ],
      };
    }
    setState(session, resolvePendingCardEffects(game).gameState);
    if (mode !== 'single') {
      expect(session.state!.activeEffect?.abilityId).toBe('system:select-pending-card-effect');
      expect(
        session.executeCommand(
          createConfirmEffectStepCommand(
            'p1',
            session.state!.activeEffect!.id,
            mode === 'manual' ? 'sayaka' : undefined,
            undefined,
            mode === 'ordered'
          )
        ).success
      ).toBe(true);
    }
    if (mode !== 'ordered') {
      expect(session.state!.activeEffect?.metadata?.confirmOnlyPendingAbility).toBe(true);
      expect(choose(session, null).success).toBe(true);
      if (mode === 'manual') {
        expect(session.state!.activeEffect?.metadata?.confirmOnlyPendingAbility).toBe(true);
        expect(choose(session, null).success).toBe(true);
      }
    }
    expect(session.state!.activeEffect).toBeNull();
    expect(session.state!.pendingAbilities).toEqual([]);
    expect(session.state!.players[0].waitingRoom.cardIds).toEqual(['target']);
  }
);

it('allows a triggered Sayaka to pay and recover after leaving stage when the other members still total 25', () => {
  const { session, discard, targets } = setup({ cost: 25 });
  setState(
    session,
    updatePlayer(session.state!, 'p1', (p) => ({
      ...p,
      memberSlots: removeCardFromSlot(p.memberSlots, SlotPosition.CENTER),
    }))
  );
  expect(choose(session, discard.instanceId).success).toBe(true);
  expect(session.state!.activeEffect?.selectableCardIds).toEqual([targets[0]!.instanceId]);
  expect(choose(session, targets[0]!.instanceId).success).toBe(true);
  expect(session.state!.players[0].hand.cardIds).toEqual([targets[0]!.instanceId]);
});

it('queues the discard trigger until recovery completes and then returns to the current pending pool', () => {
  const { session, discard, targets } = setup();
  const observer = createCardInstance(
    { ...member('PL!HS-pb1-003-R', 1), unitName: 'みらくらぱーく！' },
    'p1',
    'rurino'
  );
  let game = registerCards(session.state!, [observer]);
  game = updatePlayer(game, 'p1', (p) => ({
    ...p,
    memberSlots: placeCardInSlot(p.memberSlots, SlotPosition.RIGHT, observer.instanceId),
  }));
  setState(session, game);
  expect(session.state!.activeEffect?.metadata?.confirmOnlyPendingAbility).not.toBe(true);
  choose(session, discard.instanceId);
  expect(session.state!.activeEffect?.abilityId).toBe(ABILITY);
  expect(session.state!.pendingAbilities.some((a) => a.abilityId === RURINO_ABILITY)).toBe(true);
  const hasResolvedTrigger = () =>
    session.state!.actionHistory.some(
      (a) => a.type === 'RESOLVE_ABILITY' && a.payload.abilityId === RURINO_ABILITY
    );
  expect(hasResolvedTrigger()).toBe(false);
  choose(session, targets[0]!.instanceId, false);
  expect(hasResolvedTrigger()).toBe(false);
  expect(session.state!.players[0].waitingRoom.cardIds).toContain(targets[0]!.instanceId);
  confirmPublicSelectionIfNeeded(session);
  expect(session.state!.players[0].hand.cardIds).toEqual([targets[0]!.instanceId]);
  expect(hasResolvedTrigger()).toBe(true);
  expect(session.state!.activeEffect).toBeNull();
  expect(session.state!.pendingAbilities).toEqual([]);
});

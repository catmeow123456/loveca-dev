import { describe, expect, it } from 'vitest';
import rows from '../helpers/oct20-cost-recovery-cards.json';
import { confirmActiveEffectStepThroughPublicReveal as choose } from '../helpers/public-card-selection-confirmation';
import {
  activateCardAbility,
  confirmActiveEffectStep,
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  PL_BP8_012_ACTIVATED_WAIT_SELF_DISCARD_TWO_RECOVER_MUSE_LIVE_ABILITY_ID as KOTORI,
  N_BP8_004_ACTIVATED_HAND_PAY_TWO_DISCARD_SELF_RECOVER_BLADE_HEART_MEMBER_ABILITY_ID as KARIN,
  N_BP8_004_LIVE_START_REVEAL_NIJIGASAKI_HAND_TOP_CHOOSE_HEART_ABILITY_ID as KARIN_LIVE,
  S_CL1_006_LIVE_START_BOTTOM_HAND_GAIN_TWO_BLADE_ABILITY_ID as YOSHIKO,
  S_CL1_008_ACTIVATED_WAIT_SELF_DISCARD_DRAW_ONE_ABILITY_ID as MARI,
  S_CL1_009_ACTIVATED_SELF_SACRIFICE_RECOVER_MEMBER_ABILITY_ID as RUBY,
  HS_PB1_003_AUTO_HAND_TO_WAITING_GAIN_HEART_BLADE_ABILITY_ID as WATCHER,
} from '../../src/application/card-effects/ability-ids';
import { getCardAbilityDefinitionsForCardCode } from '../../src/application/card-effects/definitions/lookup';
import { ENERGY_OPERATION_SELECTION_STEP_ID } from '../../src/application/card-effects/runtime/energy-operation-selection';
import { PUBLIC_REVEAL_DWELL_STEP_ID } from '../../src/application/card-effects/runtime/public-reveal-dwell';
import { PUBLIC_CARD_SELECTION_CONFIRMATION_STEP_ID } from '../../src/application/card-effects/runtime/public-card-selection-confirmation';
import { createActivateAbilityCommand } from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import {
  createCardInstance,
  createHeartRequirement,
  type AnyCardData,
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
  addCardToStatefulZone,
  placeCardInSlot,
  removeCardFromSlot,
} from '../../src/domain/entities/zone';
import { createEnterStageEvent, createLiveStartEvent } from '../../src/domain/events/game-events';
import {
  getMemberEffectiveBladeCount,
  getMemberEffectiveHeartIcons,
} from '../../src/domain/rules/live-modifiers';
import { createPublicObjectId, projectPlayerViewState } from '../../src/online/projector';
import {
  BladeHeartEffect,
  CardType,
  FaceState,
  GamePhase,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
  ZoneType,
} from '../../src/shared/types/enums';

const P1 = 'p1',
  P2 = 'p2';
// Source data is a static subset of the authorized 2026-10-20 export. Null BLADE HEART stays unknown.
function data(base: string, rarity?: string): AnyCardData {
  const row = rows.find((row) => row.cardCode.startsWith(`${base}-`))!;
  const common = {
    cardCode: rarity ? `${base}-${rarity}` : row.cardCode,
    name: row.nameCn || row.nameJp,
    groupNames: row.groupNames,
    unitName: row.unitName ?? undefined,
    ...(row.bladeHearts === null
      ? {}
      : { bladeHearts: row.bladeHearts as MemberCardData['bladeHearts'] }),
  };
  if (row.cardType === 'MEMBER') {
    if (row.cost === null || row.blade === null || row.hearts === null)
      throw new Error('Unknown member fixture field');
    return {
      ...common,
      cardType: CardType.MEMBER,
      cost: row.cost,
      blade: row.blade,
      hearts: row.hearts as MemberCardData['hearts'],
    };
  }
  return {
    ...common,
    cardType: CardType.LIVE,
    score: row.score!,
    requirements: createHeartRequirement(
      Object.fromEntries(row.requirements.map(({ color, count }) => [color, count]))
    ),
  };
}
function setup(
  base: string,
  options: {
    hand?: readonly string[];
    waiting?: readonly string[];
    handSource?: boolean;
    energies?: number;
    marked?: boolean;
    watcher?: boolean;
    rarity?: string;
  } = {}
): GameState {
  const fixture = (base: string, id: string) => createCardInstance(data(base), P1, id);
  const cards = [
    createCardInstance(data(base, options.rarity), P1, 'source'),
    fixture('PL!S-cl1-008', 'hand-member'),
    fixture('PL!-bp3-019', 'hand-live'),
    fixture('PL!S-cl1-009', 'target'),
    fixture('PL!-bp3-019', 'muse-live'),
    fixture('PL!S-sd1-019', 'aqours-live'),
    fixture('PL!S-cl1-008', 'draw'),
    fixture('PL!S-cl1-008', 'deck-tail'),
    fixture('PL!HS-pb1-003', 'watcher'),
    // Synthetic energy objects contain no card-rule claims and serve only the energy operation contract.
    ...Array.from({ length: options.energies ?? 2 }, (_, index) =>
      createCardInstance(
        { cardCode: `TEST-ENERGY-${index}`, name: '测试能量', cardType: CardType.ENERGY },
        P1,
        `energy-${index}`
      )
    ),
  ];
  let game = registerCards(createGameState('oct20-cost-recovery', P1, '己方', P2, '对方'), cards);
  game = updatePlayer(game, P1, (player) => ({
    ...player,
    memberSlots: options.handSource
      ? player.memberSlots
      : placeCardInSlot(player.memberSlots, SlotPosition.CENTER, 'source', {
          orientation: OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        }),
    hand: {
      ...player.hand,
      cardIds: [
        ...(options.handSource ? ['source'] : []),
        ...(options.hand ?? ['hand-member', 'hand-live']),
      ],
    },
    waitingRoom: {
      ...player.waitingRoom,
      cardIds: [...(options.waiting ?? ['target', 'muse-live', 'aqours-live'])],
    },
    mainDeck: { ...player.mainDeck, cardIds: ['draw', 'deck-tail'] },
    energyZone: Array.from(
      { length: options.energies ?? 2 },
      (_, index) => `energy-${index}`
    ).reduce(
      (zone, id) =>
        addCardToStatefulZone(zone, id, {
          orientation: OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        }),
      player.energyZone
    ),
  }));
  if (options.watcher)
    game = updatePlayer(game, P1, (player) => ({
      ...player,
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.LEFT, 'watcher'),
    }));
  return {
    ...game,
    currentPhase: GamePhase.MAIN_PHASE,
    ...(options.marked
      ? {
          energyActivePhaseSkips: [
            {
              playerId: P1,
              energyCardId: 'energy-2',
              sourceCardId: 'test-marker',
              abilityId: 'test-marker',
            },
          ],
        }
      : {}),
  };
}
const pay = (game: GameState, ids: readonly string[]) =>
  choose(game, P1, game.activeEffect!.id, undefined, undefined, undefined, undefined, ids);
const card = (game: GameState, id?: string) => choose(game, P1, game.activeEffect!.id, id);
const activate = (game: GameState, ability: string) =>
  activateCardAbility(game, P1, 'source', ability);
function startLive(game: GameState): GameState {
  const state = emitGameEvent(
    { ...game, currentPhase: GamePhase.PERFORMANCE_PHASE },
    createLiveStartEvent(P1, [])
  );
  return resolvePendingCardEffects(
    enqueueTriggeredCardEffects(state, [TriggerCondition.ON_LIVE_START])
  ).gameState;
}
const events = (game: GameState, kind: TriggerCondition) =>
  game.eventLog.filter(({ event }) => event.eventType === kind).map(({ event }) => event);
function reenter(game: GameState): GameState {
  const moved = updatePlayer(game, P1, (player) => ({
    ...player,
    memberSlots: placeCardInSlot(
      removeCardFromSlot(player.memberSlots, SlotPosition.CENTER),
      SlotPosition.CENTER,
      'source'
    ),
  }));
  return emitGameEvent(
    moved,
    createEnterStageEvent('source', ZoneType.WAITING_ROOM, SlotPosition.CENTER, P1, P1)
  );
}

describe('October 20 cost/recovery source registration and exact text', () => {
  it.each([
    ['PL!-bp8-012', [KOTORI]],
    ['PL!N-bp8-004', [KARIN, KARIN_LIVE]],
    ['PL!S-cl1-006', [YOSHIKO]],
    ['PL!S-cl1-008', [MARI]],
    ['PL!S-cl1-009', [RUBY]],
  ] as const)(
    '%s covers current and future printings with each full exported ability',
    (base, ids) => {
      const paragraphs = rows
        .find((row) => row.cardCode.startsWith(`${base}-`))!
        .cardTextCn.split('\n\n');
      for (const code of [data(base).cardCode, `${base}-FUTURE`]) {
        const definitions = getCardAbilityDefinitionsForCardCode(code);
        expect(definitions.map(({ abilityId }) => abilityId)).toEqual([...ids]);
        definitions.forEach((definition, index) => {
          expect(definition.baseCardCodes).toEqual([base]);
          expect(definition.effectText).toBe(paragraphs[index]);
          if (definition.activatedUi) expect(definition.activatedUi.text).toBe(paragraphs[index]);
        });
      }
      if (base === 'PL!N-bp8-004') expect(data(base).bladeHearts).toBeUndefined();
    }
  );
});

describe('费用9 南琴梨：待机和批量弃两张后回收μ’s LIVE', () => {
  it.each(['N', 'FUTURE'])(
    'pays one grouped discard, can recover the newly discarded LIVE, then runs downstream triggers: %s',
    (rarity) => {
      const game = setup('PL!-bp8-012', {
        waiting: ['target', 'aqours-live'],
        watcher: true,
        rarity,
      });
      const started = activate(game, KOTORI);
      expect(started.players[0].memberSlots.cardStates.get('source')?.orientation).toBe(
        OrientationState.WAITING
      );
      expect(started.activeEffect).toMatchObject({
        selectableCardMode: 'ORDERED_MULTI',
        minSelectableCards: 2,
        maxSelectableCards: 2,
        canSkipSelection: false,
      });
      expect(pay(started, ['hand-member'])).toBe(started);
      expect(pay(started, ['hand-member', 'hand-member'])).toBe(started);
      const recovery = pay(started, ['hand-member', 'hand-live']);
      expect(recovery.activeEffect?.selectableCardIds).toEqual(['hand-live']);
      expect(events(recovery, TriggerCondition.ON_ENTER_WAITING_ROOM)).toMatchObject([
        {
          cardInstanceIds: ['hand-member', 'hand-live'],
          fromZone: ZoneType.HAND,
          toZone: ZoneType.WAITING_ROOM,
        },
      ]);
      expect(events(recovery, TriggerCondition.ON_MEMBER_STATE_CHANGED)).toHaveLength(1);
      expect(recovery.pendingAbilities.some(({ abilityId }) => abilityId === WATCHER)).toBe(true);
      expect(
        recovery.liveResolution.liveModifiers.filter(({ abilityId }) => abilityId === WATCHER)
      ).toHaveLength(0);
      const done = card(recovery, 'hand-live');
      expect(done.players[0].hand.cardIds).toEqual(['hand-live']);
      expect(
        done.liveResolution.liveModifiers.filter(({ abilityId }) => abilityId === WATCHER)
      ).toHaveLength(2);
      const readyAgain = updatePlayer(done, P1, (player) => ({
        ...player,
        memberSlots: {
          ...player.memberSlots,
          cardStates: new Map(player.memberSlots.cardStates).set('source', {
            orientation: OrientationState.ACTIVE,
            face: FaceState.FACE_UP,
          }),
        },
        hand: { ...player.hand, cardIds: ['hand-live', 'target'] },
      }));
      expect(activate(readyAgain, KOTORI)).toBe(readyAgain);
    }
  );
  it('does not wait with fewer than two cards, and retains the full cost when no LIVE exists', () => {
    const short = setup('PL!-bp8-012', { hand: ['hand-member'] });
    expect(activate(short, KOTORI)).toBe(short);
    const game = setup('PL!-bp8-012', { hand: ['hand-member', 'target'], waiting: [] });
    const done = pay(activate(game, KOTORI), ['hand-member', 'target']);
    expect(done.activeEffect).toBeNull();
    expect(done.players[0].waitingRoom.cardIds).toEqual(['hand-member', 'target']);
    expect(done.players[0].memberSlots.cardStates.get('source')?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(done.actionHistory.at(-1)?.payload.step).toBe('PAID_COST_NO_TARGET');
  });
  it('rejects stale cost/target IDs and completes recovery after the source leaves', () => {
    const started = activate(setup('PL!-bp8-012'), KOTORI);
    const stale = updatePlayer(started, P1, (player) => ({
      ...player,
      hand: { ...player.hand, cardIds: ['hand-member'] },
    }));
    expect(pay(stale, ['hand-member', 'hand-live'])).toBe(stale);
    const recovery = pay(started, ['hand-member', 'hand-live']);
    expect(card(recovery, 'target')).toBe(recovery);
    const left = updatePlayer(recovery, P1, (player) => ({
      ...player,
      memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.CENTER),
    }));
    expect(card(left, 'muse-live').players[0].hand.cardIds).toContain('muse-live');
  });
});

describe('费用4 小原鞠莉、费用2 黑泽露比的既有family配置', () => {
  it('Mari discards before draw, emits exactly one discard/state event and enforces turn1', () => {
    const started = activate(setup('PL!S-cl1-008', { hand: ['hand-member'] }), MARI);
    const done = card(started, 'hand-member');
    expect(done.players[0].hand.cardIds).toEqual(['draw']);
    expect(done.players[0].waitingRoom.cardIds).toContain('hand-member');
    expect(events(done, TriggerCondition.ON_ENTER_WAITING_ROOM)).toHaveLength(1);
    expect(events(done, TriggerCondition.ON_MEMBER_STATE_CHANGED)).toHaveLength(1);
    expect(done.activeEffect).toBeNull();
    const activeAgain = updatePlayer(done, P1, (player) => ({
      ...player,
      memberSlots: {
        ...player.memberSlots,
        cardStates: new Map(player.memberSlots.cardStates).set('source', {
          orientation: OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        }),
      },
    }));
    expect(activate(activeAgain, MARI)).toBe(activeAgain);
    const noHand = setup('PL!S-cl1-008', { hand: [] });
    expect(activate(noHand, MARI)).toBe(noHand);
  });
  it.each([OrientationState.ACTIVE, OrientationState.WAITING])(
    'Ruby self-sacrifices first and can recover herself with no initial waiting-room target: %s',
    (orientation) => {
      let game = setup('PL!S-cl1-009', { hand: [], waiting: [] });
      game = updatePlayer(game, P1, (player) => ({
        ...player,
        memberSlots: {
          ...player.memberSlots,
          cardStates: new Map(player.memberSlots.cardStates).set('source', {
            orientation,
            face: FaceState.FACE_UP,
          }),
        },
      }));
      const recovery = activate(game, RUBY);
      expect(recovery.players[0].memberSlots.slots.CENTER).toBeNull();
      expect(recovery.activeEffect?.selectableCardIds).toEqual(['source']);
      expect(events(recovery, TriggerCondition.ON_LEAVE_STAGE)).toHaveLength(1);
      const publicWindow = confirmActiveEffectStep(
        recovery,
        P1,
        recovery.activeEffect!.id,
        'source'
      );
      expect(publicWindow.activeEffect?.stepId).toBe(PUBLIC_CARD_SELECTION_CONFIRMATION_STEP_ID);
      expect(publicWindow.players[0].waitingRoom.cardIds).toEqual(['source']);
      expect(publicWindow.players[0].hand.cardIds).toEqual([]);
      const done = card(publicWindow);
      expect(done.players[0].hand.cardIds).toEqual(['source']);
      expect(done.activeEffect).toBeNull();
      expect(confirmActiveEffectStep(done, P1, recovery.activeEffect!.id, 'source')).toBe(done);
    }
  );
});

describe('费用9 朝香果林的HAND支付及LIVE公开入顶', () => {
  it('the official command starts from hand, pays exact energy, filters unknown/non-member targets and reveals before recovery', () => {
    const game = setup('PL!N-bp8-004', {
      handSource: true,
      hand: [],
      waiting: ['target', 'muse-live', 'hand-member'],
    });
    const session = createGameSession();
    (session as unknown as { authorityState: GameState }).authorityState = game;
    expect(session.executeCommand(createActivateAbilityCommand(P1, 'source', KARIN)).success).toBe(
      true
    );
    const started = session.state!;
    expect(started.players[0].waitingRoom.cardIds).toContain('source');
    expect(started.activeEffect?.selectableCardIds).toEqual(['target', 'hand-member']);
    expect(started.activeEffect?.selectableCardIds).not.toContain('source');
    expect(
      started.players[0].energyZone.cardIds.filter(
        (id) =>
          started.players[0].energyZone.cardStates.get(id)?.orientation === OrientationState.WAITING
      )
    ).toEqual(['energy-0', 'energy-1']);
    expect(events(started, TriggerCondition.ON_ENTER_WAITING_ROOM)).toMatchObject([
      { cardInstanceIds: ['source'], fromZone: ZoneType.HAND },
    ]);
    const reveal = confirmActiveEffectStep(started, P1, started.activeEffect!.id, 'target');
    expect(reveal.activeEffect?.stepId).toBe(PUBLIC_CARD_SELECTION_CONFIRMATION_STEP_ID);
    expect(reveal.players[0].waitingRoom.cardIds).toContain('target');
    expect(card(reveal).players[0].hand.cardIds).toContain('target');
  });
  it('allows paying with no target; insufficient or stale hand-source energy payment is atomic', () => {
    const done = activate(
      setup('PL!N-bp8-004', { handSource: true, hand: [], waiting: [] }),
      KARIN
    );
    expect(done.activeEffect).toBeNull();
    expect(done.players[0].waitingRoom.cardIds).toEqual(['source']);
    const short = setup('PL!N-bp8-004', { handSource: true, energies: 1 });
    expect(activate(short, KARIN)).toBe(short);
    const selected = activate(
      setup('PL!N-bp8-004', { handSource: true, energies: 3, marked: true }),
      KARIN
    );
    expect(selected.activeEffect?.stepId).toBe(ENERGY_OPERATION_SELECTION_STEP_ID);
    expect(pay(selected, ['energy-0', 'energy-0'])).toBe(selected);
    const stale = updatePlayer(selected, P1, (player) => ({
      ...player,
      hand: { ...player.hand, cardIds: [] },
    }));
    const failed = pay(stale, ['energy-0', 'energy-2']);
    expect(
      failed.players[0].energyZone.cardIds.every(
        (id) =>
          failed.players[0].energyZone.cardStates.get(id)?.orientation === OrientationState.ACTIVE
      )
    ).toBe(true);
    expect(failed.players[0].waitingRoom.cardIds).not.toContain('source');
    const paid = pay(selected, ['energy-0', 'energy-2']);
    expect(paid.players[0].energyZone.cardStates.get('energy-1')?.orientation).toBe(
      OrientationState.ACTIVE
    );
    expect(paid.players[0].waitingRoom.cardIds).toContain('source');
  });
  it('revalidates timed recovery targets and resolves discard triggers only after recovery or no-target completion', () => {
    const started = activate(
      setup('PL!N-bp8-004', { handSource: true, hand: [], waiting: ['target'], watcher: true }),
      KARIN
    );
    expect(started.pendingAbilities.some(({ abilityId }) => abilityId === WATCHER)).toBe(true);
    expect(
      started.liveResolution.liveModifiers.filter(({ abilityId }) => abilityId === WATCHER)
    ).toEqual([]);
    const reveal = confirmActiveEffectStep(started, P1, started.activeEffect!.id, 'target');
    const stale = updatePlayer(reveal, P1, (player) => ({
      ...player,
      waitingRoom: {
        ...player.waitingRoom,
        cardIds: player.waitingRoom.cardIds.filter((id) => id !== 'target'),
      },
    }));
    const done = card(stale);
    expect(done.activeEffect).toBeNull();
    expect(done.players[0].hand.cardIds).not.toContain('target');
    expect(
      done.liveResolution.liveModifiers.filter(({ abilityId }) => abilityId === WATCHER)
    ).toHaveLength(2);
    expect(
      done.players[0].energyZone.cardIds.every(
        (id) =>
          done.players[0].energyZone.cardStates.get(id)?.orientation === OrientationState.WAITING
      )
    ).toBe(true);
    const noTarget = activate(
      setup('PL!N-bp8-004', { handSource: true, hand: [], waiting: [], watcher: true }),
      KARIN
    );
    expect(noTarget.activeEffect).toBeNull();
    expect(
      noTarget.liveResolution.liveModifiers.filter(({ abilityId }) => abilityId === WATCHER)
    ).toHaveLength(2);
  });
  it('recognizes every BLADE HEART effect on MEMBER, while rejecting LIVE regardless of its BLADE HEART', () => {
    // Explicit synthetic schema cases; these are not guesses about missing export fields.
    let game = setup('PL!N-bp8-004', { handSource: true, hand: [], waiting: [] });
    const synthetic = [BladeHeartEffect.HEART, BladeHeartEffect.DRAW, BladeHeartEffect.SCORE].map(
      (effect, index) =>
        createCardInstance(
          {
            ...(data('PL!S-cl1-009') as MemberCardData),
            cardCode: `SYNTHETIC-BLADE-HEART-${effect}`,
            bladeHearts: [
              {
                effect,
                ...(effect === BladeHeartEffect.HEART ? { heartColor: HeartColor.BLUE } : {}),
              },
            ],
          },
          P1,
          `synthetic-${index}`
        )
    );
    game = registerCards(game, synthetic);
    game = updatePlayer(game, P1, (player) => ({
      ...player,
      waitingRoom: {
        ...player.waitingRoom,
        cardIds: synthetic.map(({ instanceId }) => instanceId),
      },
    }));
    expect(activate(game, KARIN).activeEffect?.selectableCardIds).toEqual([
      'synthetic-0',
      'synthetic-1',
      'synthetic-2',
    ]);
  });
  it('reveals only the selected hand MEMBER to both players, moves at dwell end, then requires a six-color choice', () => {
    const base = setup('PL!N-bp8-004', { hand: ['hand-member', 'target'], waiting: [] });
    // The actual Ruby is Aqours. Use a second actual Karin instance as the eligible Nijigasaki hand card.
    let game = registerCards(base, [createCardInstance(data('PL!N-bp8-004'), P1, 'niji-hand')]);
    game = updatePlayer(game, P1, (player) => ({
      ...player,
      hand: { ...player.hand, cardIds: [...player.hand.cardIds, 'niji-hand'] },
    }));
    const started = startLive(game);
    expect(started.activeEffect?.selectableCardIds).toEqual(['niji-hand']);
    const reveal = confirmActiveEffectStep(started, P1, started.activeEffect!.id, 'niji-hand');
    expect(reveal.activeEffect?.stepId).toBe(PUBLIC_REVEAL_DWELL_STEP_ID);
    expect(reveal.players[0].mainDeck.cardIds).toEqual(['draw', 'deck-tail']);
    for (const viewer of [P1, P2]) {
      const view = projectPlayerViewState(reveal, viewer);
      expect(view.activeEffect?.revealedObjectIds).toEqual([createPublicObjectId('niji-hand')]);
      expect(view.objects[createPublicObjectId('niji-hand')]?.surface).toBe('FRONT');
    }
    const colors = card(reveal);
    expect(colors.players[0].mainDeck.cardIds).toEqual(['niji-hand', 'draw', 'deck-tail']);
    expect(colors.activeEffect?.effectChoice?.options.map(({ id }) => id)).toEqual([
      HeartColor.PINK,
      HeartColor.RED,
      HeartColor.YELLOW,
      HeartColor.GREEN,
      HeartColor.BLUE,
      HeartColor.PURPLE,
    ]);
    expect(
      choose(
        colors,
        P1,
        colors.activeEffect!.id,
        undefined,
        undefined,
        undefined,
        HeartColor.ORANGE
      )
    ).toBe(colors);
    const done = choose(
      colors,
      P1,
      colors.activeEffect!.id,
      undefined,
      undefined,
      undefined,
      HeartColor.RED
    );
    expect(getMemberEffectiveHeartIcons(done, P1, 'source')).toContainEqual({
      color: HeartColor.RED,
      count: 1,
    });
    expect(done.activeEffect).toBeNull();
  });
  it('declines without cost, continues after a stale revealed card, and never rewards a re-entered source', () => {
    let game = setup('PL!N-bp8-004', { hand: [], waiting: [] });
    game = registerCards(game, [createCardInstance(data('PL!N-bp8-004'), P1, 'niji-hand')]);
    game = updatePlayer(game, P1, (player) => ({
      ...player,
      hand: { ...player.hand, cardIds: ['niji-hand'] },
    }));
    const started = startLive(game);
    const declined = card(started);
    expect(declined.players[0].hand.cardIds).toEqual(['niji-hand']);
    expect(declined.activeEffect).toBeNull();
    const reveal = confirmActiveEffectStep(started, P1, started.activeEffect!.id, 'niji-hand');
    const stale = updatePlayer(reveal, P1, (player) => ({
      ...player,
      hand: { ...player.hand, cardIds: [] },
    }));
    const staleColors = card(stale);
    expect(staleColors.activeEffect?.effectChoice?.options).toHaveLength(6);
    expect(staleColors.players[0].mainDeck.cardIds).toEqual(['draw', 'deck-tail']);
    expect(
      staleColors.actionHistory.find(
        (action) => action.type === 'PAY_COST' && action.payload.abilityId === KARIN_LIVE
      )?.payload.revealedHandCardIds
    ).toEqual(['niji-hand']);
    const stillGains = choose(
      staleColors,
      P1,
      staleColors.activeEffect!.id,
      undefined,
      undefined,
      undefined,
      HeartColor.RED
    );
    expect(getMemberEffectiveHeartIcons(stillGains, P1, 'source')).toContainEqual({
      color: HeartColor.RED,
      count: 1,
    });
    expect(
      declined.actionHistory.some(
        (action) => action.type === 'PAY_COST' && action.payload.abilityId === KARIN_LIVE
      )
    ).toBe(false);
    const colors = card(reenter(reveal));
    const done = choose(
      colors,
      P1,
      colors.activeEffect!.id,
      undefined,
      undefined,
      undefined,
      HeartColor.RED
    );
    expect(
      done.liveResolution.liveModifiers.filter(({ abilityId }) => abilityId === KARIN_LIVE)
    ).toEqual([]);
    expect(done.players[0].mainDeck.cardIds[0]).toBe('niji-hand');
  });
});

describe('费用7 津岛善子：私密手牌入底费用与来源BLADE', () => {
  it('bottoms one privately, never emits a discard event, and grants exactly two BLADE', () => {
    const started = startLive(setup('PL!S-cl1-006', { hand: ['hand-member'] }));
    expect(started.activeEffect).toMatchObject({
      selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
      confirmSelectionLabel: '放置于卡组底',
      skipSelectionLabel: '不发动',
    });
    const done = card(started, 'hand-member');
    expect(done.players[0].mainDeck.cardIds).toEqual(['draw', 'deck-tail', 'hand-member']);
    expect(events(done, TriggerCondition.ON_ENTER_WAITING_ROOM)).toEqual([]);
    expect(getMemberEffectiveBladeCount(done, P1, 'source')).toBe(4);
    expect(done.activeEffect).toBeNull();
  });
  it('supports decline/no hand, rejects stale IDs, and pays without rewarding a re-entered source', () => {
    const started = startLive(setup('PL!S-cl1-006', { hand: ['hand-member'] }));
    expect(card(started).players[0].hand.cardIds).toEqual(['hand-member']);
    expect(startLive(setup('PL!S-cl1-006', { hand: [] })).activeEffect).toBeNull();
    const stale = updatePlayer(started, P1, (player) => ({
      ...player,
      hand: { ...player.hand, cardIds: [] },
    }));
    expect(card(stale, 'hand-member')).toBe(stale);
    const done = card(reenter(started), 'hand-member');
    expect(done.players[0].mainDeck.cardIds.at(-1)).toBe('hand-member');
    expect(getMemberEffectiveBladeCount(done, P1, 'source')).toBe(2);
  });
});

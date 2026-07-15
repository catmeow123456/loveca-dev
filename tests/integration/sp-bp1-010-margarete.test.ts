import { describe, expect, it } from 'vitest';
import type { EnergyCardData, LiveCardData, MemberCardData } from '../../src/domain/entities/card';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
  type CardInstance,
} from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import {
  addCardToStatefulZone,
  placeCardInSlot,
  removeCardFromSlot,
} from '../../src/domain/entities/zone';
import {
  createActivateAbilityCommand,
  createConfirmEffectStepCommand,
} from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import {
  SP_BP1_010_ACTIVATED_PAY_TWO_ENERGY_DISCARD_LOOK_TOP_FIVE_LIELLA_ABILITY_ID,
  SP_BP5_005_AUTO_MAIN_PHASE_CARD_ENTER_WAITING_ROOM_PAY_ENERGY_RECOVER_ABILITY_ID,
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
  TurnType,
  ZoneType,
} from '../../src/shared/types/enums';

const P1 = 'player1';
const P2 = 'player2';

function member(code: string, id: string, groupNames: readonly string[] = ['Liella!'], owner = P1) {
  return createCardInstance<MemberCardData>(
    {
      cardCode: code,
      name: id,
      groupNames,
      cardType: CardType.MEMBER,
      cost: 11,
      blade: 1,
      hearts: [createHeartIcon(HeartColor.PURPLE, 1)],
    },
    owner,
    id
  );
}

function live(code: string, id: string, groupNames: readonly string[] = ['Liella!']) {
  return createCardInstance<LiveCardData>(
    {
      cardCode: code,
      name: id,
      groupNames,
      cardType: CardType.LIVE,
      score: 4,
      requirements: createHeartRequirement({ [HeartColor.PURPLE]: 1 }),
    },
    P1,
    id
  );
}

function energy(id: string) {
  return createCardInstance<EnergyCardData>(
    { cardCode: `ENERGY-${id}`, name: id, cardType: CardType.ENERGY },
    P1,
    id
  );
}

function setup(
  options: {
    readonly sourceCode?: string;
    readonly sourceOnStage?: boolean;
    readonly activePlayerIndex?: number;
    readonly phase?: GamePhase;
    readonly activeEnergy?: number;
    readonly waitingEnergy?: number;
    readonly handCount?: number;
    readonly deck?: readonly CardInstance[];
    readonly waiting?: readonly CardInstance[];
    readonly specialEnergy?: boolean;
  } = {}
) {
  const source = member(options.sourceCode ?? 'PL!SP-bp1-010-P', 'margarete-source');
  const activeEnergies = Array.from({ length: options.activeEnergy ?? 2 }, (_, index) =>
    energy(`active-energy-${index}`)
  );
  const waitingEnergies = Array.from({ length: options.waitingEnergy ?? 0 }, (_, index) =>
    energy(`waiting-energy-${index}`)
  );
  const hand = Array.from({ length: options.handCount ?? 1 }, (_, index) =>
    member(`HAND-${index}`, `hand-${index}`, ['虹ヶ咲'])
  );
  const deck = [...(options.deck ?? [])];
  const waiting = [...(options.waiting ?? [])];
  let game = registerCards(createGameState('sp-bp1-010', P1, 'P1', P2, 'P2'), [
    source,
    ...activeEnergies,
    ...waitingEnergies,
    ...hand,
    ...deck,
    ...waiting,
  ]);
  game = updatePlayer(game, P1, (player) => ({
    ...player,
    memberSlots:
      options.sourceOnStage === false
        ? player.memberSlots
        : placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
            orientation: OrientationState.ACTIVE,
            face: FaceState.FACE_UP,
          }),
    hand: { ...player.hand, cardIds: hand.map((card) => card.instanceId) },
    mainDeck: { ...player.mainDeck, cardIds: deck.map((card) => card.instanceId) },
    waitingRoom: { ...player.waitingRoom, cardIds: waiting.map((card) => card.instanceId) },
    energyZone: [...activeEnergies, ...waitingEnergies].reduce(
      (zone, card, index) =>
        addCardToStatefulZone(zone, card.instanceId, {
          orientation:
            index < activeEnergies.length ? OrientationState.ACTIVE : OrientationState.WAITING,
          face: FaceState.FACE_UP,
        }),
      { ...player.energyZone, cardIds: [], cardStates: new Map() }
    ),
  }));
  game = {
    ...game,
    currentPhase: options.phase ?? GamePhase.MAIN_PHASE,
    currentSubPhase: SubPhase.NONE,
    currentTurnType: TurnType.NORMAL,
    activePlayerIndex: options.activePlayerIndex ?? 0,
    waitingPlayerId: null,
    energyActivePhaseSkips:
      options.specialEnergy && activeEnergies[1]
        ? [
            {
              playerId: P1,
              energyCardId: activeEnergies[1].instanceId,
              sourceCardId: 'special-marker',
              abilityId: 'special-marker',
            },
          ]
        : [],
  };
  const session = createGameSession();
  session.createGame('sp-bp1-010-session', P1, 'P1', P2, 'P2');
  (session as unknown as { authorityState: GameState }).authorityState = game;
  return { session, source, activeEnergies, waitingEnergies, hand, deck, waiting };
}

function activate(context: ReturnType<typeof setup>, playerId = P1) {
  return context.session.executeCommand(
    createActivateAbilityCommand(
      playerId,
      context.source.instanceId,
      SP_BP1_010_ACTIVATED_PAY_TWO_ENERGY_DISCARD_LOOK_TOP_FIVE_LIELLA_ABILITY_ID
    )
  );
}

function confirm(
  context: ReturnType<typeof setup>,
  cardId?: string,
  selectedCardIds?: readonly string[]
) {
  return context.session.executeCommand(
    createConfirmEffectStepCommand(
      P1,
      context.session.state!.activeEffect!.id,
      cardId,
      undefined,
      undefined,
      undefined,
      selectedCardIds
    )
  );
}

function abilityUseCount(game: GameState): number {
  return game.actionHistory.filter(
    (action) =>
      action.type === 'RESOLVE_ABILITY' &&
      action.payload.abilityId ===
        SP_BP1_010_ACTIVATED_PAY_TWO_ENERGY_DISCARD_LOOK_TOP_FIVE_LIELLA_ABILITY_ID &&
      action.payload.step === 'ABILITY_USE'
  ).length;
}

describe('PL!SP-bp1-010 Margarete activated composite cost', () => {
  it.each(['PL!SP-bp1-010-P', 'PL!SP-bp1-010-R'])(
    '%s opens exact private composite-cost copy and records actual payment',
    (sourceCode) => {
      const target = member('PL!SP-test-member', 'liella-member');
      const context = setup({ sourceCode, deck: [target] });
      expect(activate(context).success).toBe(true);
      expect(context.session.state?.activeEffect).toMatchObject({
        effectText:
          '【起动】【1回合1次】[E][E]将1张手牌放置入休息室：检视自己卡组顶的5张卡。可以将1张其中的『Liella!』的卡片公开并加入手牌。其余的卡片放置入休息室。',
        selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
        minSelectableCards: 1,
        maxSelectableCards: 1,
        canSkipSelection: true,
      });
      expect(confirm(context, context.hand[0]!.instanceId).success).toBe(true);
      expect(context.session.state?.activeEffect).toMatchObject({
        selectableCardIds: [target.instanceId],
        selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
        metadata: { countRule: { minCount: 0, maxCount: 1 } },
      });
      expect(
        context.session.state?.actionHistory.find((a) => a.type === 'PAY_COST')?.payload
      ).toMatchObject({
        energyCardIds: ['active-energy-0', 'active-energy-1'],
        discardedCardId: 'hand-0',
        discardedCardIds: ['hand-0'],
        enterWaitingRoomEventId: expect.any(String),
      });
      expect(abilityUseCount(context.session.state!)).toBe(1);
    }
  );

  it.each([
    ['opponent turn', { activePlayerIndex: 1 }],
    ['non-main phase', { phase: GamePhase.ACTIVE_PHASE }],
    ['source off stage', { sourceOnStage: false }],
    ['wrong definition card', { sourceCode: 'PL!SP-bp1-009-P' }],
    ['energy shortage', { activeEnergy: 1 }],
    ['WAITING energy only', { activeEnergy: 0, waitingEnergy: 2 }],
    ['no hand', { handCount: 0 }],
  ] as const)('rejects %s with no cost or use', (_label, options) => {
    const context = setup(options);
    expect(activate(context).success).toBe(false);
    expect(context.session.state?.actionHistory.some((action) => action.type === 'PAY_COST')).toBe(
      false
    );
    expect(abilityUseCount(context.session.state!)).toBe(0);
  });

  it('decline, forged, duplicate, and stale discard input preserve atomic resources and turn use', () => {
    const declined = setup();
    expect(activate(declined).success).toBe(true);
    expect(confirm(declined).success).toBe(true);
    expect(abilityUseCount(declined.session.state!)).toBe(0);
    expect(declined.session.state?.players[0].hand.cardIds).toEqual(['hand-0']);

    for (const selected of [['forged'], ['hand-0', 'hand-0']]) {
      const context = setup();
      expect(activate(context).success).toBe(true);
      const before = context.session.state!;
      expect(confirm(context, undefined, selected).success).toBe(false);
      expect(context.session.state?.actionHistory).toHaveLength(before.actionHistory.length);
      expect(context.session.state?.players[0].hand.cardIds).toEqual(['hand-0']);
      expect(
        context.session.state?.players[0].energyZone.cardStates.get('active-energy-0')?.orientation
      ).toBe(OrientationState.ACTIVE);
      expect(abilityUseCount(context.session.state!)).toBe(0);
    }

    const stale = setup();
    expect(activate(stale).success).toBe(true);
    (stale.session as unknown as { authorityState: GameState }).authorityState = updatePlayer(
      stale.session.state!,
      P1,
      (player) => ({ ...player, hand: { ...player.hand, cardIds: [] } })
    );
    expect(confirm(stale, 'hand-0').success).toBe(false);
    expect(
      stale.session.state?.players[0].energyZone.cardStates.get('active-energy-0')?.orientation
    ).toBe(OrientationState.ACTIVE);
    expect(abilityUseCount(stale.session.state!)).toBe(0);
  });

  it('supports exact special-energy selection and does not double-pay repeated input', () => {
    const context = setup({ activeEnergy: 3, specialEnergy: true });
    expect(activate(context).success).toBe(true);
    expect(confirm(context, 'hand-0').success).toBe(true);
    expect(context.session.state?.activeEffect).toMatchObject({ minSelectableCards: 2 });
    expect(confirm(context, undefined, ['forged', 'active-energy-0']).success).toBe(false);
    const energyEffectId = context.session.state!.activeEffect!.id;
    expect(confirm(context, undefined, ['active-energy-1', 'active-energy-2']).success).toBe(true);
    expect(
      context.session.state?.actionHistory.find((a) => a.type === 'PAY_COST')?.payload
    ).toMatchObject({ energyCardIds: ['active-energy-1', 'active-energy-2'] });
    context.session.executeCommand(createConfirmEffectStepCommand(P1, energyEffectId));
    expect(abilityUseCount(context.session.state!)).toBe(1);
    expect(
      context.session.state?.actionHistory.filter((action) => action.type === 'PAY_COST')
    ).toHaveLength(1);
  });

  it('allows the source to move or leave after activation without cancelling the accepted lifecycle', () => {
    for (const mode of ['move', 'leave'] as const) {
      const target = member('PL!SP-test-member', `target-${mode}`);
      const context = setup({ deck: [target] });
      expect(activate(context).success).toBe(true);
      (context.session as unknown as { authorityState: GameState }).authorityState = updatePlayer(
        context.session.state!,
        P1,
        (player) => {
          const withoutCenter = removeCardFromSlot(player.memberSlots, SlotPosition.CENTER);
          return {
            ...player,
            memberSlots:
              mode === 'move'
                ? placeCardInSlot(withoutCenter, SlotPosition.LEFT, context.source.instanceId, {
                    orientation: OrientationState.ACTIVE,
                    face: FaceState.FACE_UP,
                  })
                : withoutCenter,
          };
        }
      );
      expect(confirm(context, 'hand-0').success).toBe(true);
      expect(context.session.state?.activeEffect?.inspectionCardIds).toEqual([
        target.instanceId,
        'hand-0',
      ]);
    }
  });

  it('matches Liella! MEMBER/LIVE identities, excludes others, and reveals only the chosen card', () => {
    const liellaMember = member('LIELLA-MEMBER', 'liella-member', [' Liella! ', 'リエラ']);
    const liellaLive = live('LIELLA-LIVE', 'liella-live', ['Liella!']);
    const nonLiella = member('OTHER', 'other', ['虹ヶ咲']);
    const context = setup({ deck: [liellaMember, liellaLive, nonLiella] });
    expect(activate(context).success).toBe(true);
    expect(confirm(context, 'hand-0').success).toBe(true);
    expect(context.session.state?.activeEffect?.selectableCardIds).toEqual([
      liellaMember.instanceId,
      liellaLive.instanceId,
    ]);
    expect(confirm(context, liellaLive.instanceId).success).toBe(true);
    expect(context.session.state?.inspectionZone.revealedCardIds).toEqual([liellaLive.instanceId]);
    expect(context.session.state?.players[0].hand.cardIds).not.toContain(liellaLive.instanceId);
    expect(confirm(context).success).toBe(true);
    expect(context.session.state?.players[0].hand.cardIds).toContain(liellaLive.instanceId);
    expect(new Set(context.session.state?.players[0].waitingRoom.cardIds)).toEqual(
      new Set(['hand-0', liellaMember.instanceId, nonLiella.instanceId])
    );
    expect(
      context.session.state?.eventLog.find(
        (entry) =>
          entry.event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM &&
          entry.event.fromZone === ZoneType.MAIN_DECK
      )?.event.cardInstanceIds
    ).toEqual(expect.arrayContaining(['hand-0', liellaMember.instanceId, nonLiella.instanceId]));
  });

  it.each([
    [0, 1],
    [1, 2],
    [2, 3],
    [3, 4],
    [4, 5],
    [5, 5],
  ])(
    'starts with %i main-deck cards, follows refresh, and permits choosing zero',
    (count, expected) => {
      const cards = Array.from({ length: count }, (_, index) =>
        member(`CARD-${index}`, `card-${index}`, index === 0 ? ['Liella!'] : ['虹ヶ咲'])
      );
      const context = setup({ deck: cards });
      expect(activate(context).success).toBe(true);
      expect(confirm(context, 'hand-0').success).toBe(true);
      expect(context.session.state?.activeEffect?.inspectionCardIds).toHaveLength(expected);
      expect(confirm(context).success).toBe(true);
      const expectedWaiting =
        count < 5
          ? ['hand-0', ...cards.map((card) => card.instanceId)]
          : cards.map((card) => card.instanceId);
      expect(new Set(context.session.state?.players[0].waitingRoom.cardIds)).toEqual(
        new Set(expectedWaiting)
      );
      if (count === 5) {
        expect(context.session.state?.players[0].mainDeck.cardIds).toEqual(['hand-0']);
      }
    }
  );

  it('refreshes before inspecting and rejects non-inspected, duplicate, stale, and repeated selection', () => {
    const refreshCards = [
      member('REFRESH-0', 'refresh-0'),
      member('REFRESH-1', 'refresh-1', ['虹ヶ咲']),
    ];
    const context = setup({ waiting: refreshCards });
    expect(activate(context).success).toBe(true);
    expect(confirm(context, 'hand-0').success).toBe(true);
    expect(new Set(context.session.state?.activeEffect?.inspectionCardIds)).toEqual(
      new Set(['hand-0', ...refreshCards.map((card) => card.instanceId)])
    );
    const before = context.session.state!;
    expect(confirm(context, 'forged').success).toBe(false);
    expect(confirm(context, undefined, ['refresh-0', 'refresh-0']).success).toBe(false);
    expect(context.session.state?.actionHistory).toHaveLength(before.actionHistory.length);

    (context.session as unknown as { authorityState: GameState }).authorityState = {
      ...context.session.state!,
      inspectionZone: {
        ...context.session.state!.inspectionZone,
        cardIds: context.session.state!.inspectionZone.cardIds.filter((id) => id !== 'refresh-0'),
      },
    };
    expect(confirm(context, 'refresh-0').success).toBe(false);
  });

  it('records use only after full cost and rejects a second activation in the turn', () => {
    const context = setup({ activeEnergy: 4, handCount: 2 });
    expect(activate(context).success).toBe(true);
    expect(confirm(context, 'hand-0').success).toBe(true);
    expect(abilityUseCount(context.session.state!)).toBe(1);
    expect(activate(context).success).toBe(false);
    expect(abilityUseCount(context.session.state!)).toBe(1);
  });

  it('queues discard-trigger pending behind inspection and only schedules it after this ability finishes', () => {
    const inspected = member('INSPECTED', 'inspected', ['虹ヶ咲']);
    const watcher = member('PL!SP-bp5-005-P', 'waiting-room-watcher');
    const context = setup({ activeEnergy: 3, deck: [inspected] });
    let game = registerCards(context.session.state!, [watcher]);
    game = updatePlayer(game, P1, (player) => ({
      ...player,
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.LEFT, watcher.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }),
    }));
    (context.session as unknown as { authorityState: GameState }).authorityState = game;

    expect(activate(context).success).toBe(true);
    expect(confirm(context, 'hand-0').success).toBe(true);
    expect(context.session.state?.activeEffect).toMatchObject({
      abilityId: SP_BP1_010_ACTIVATED_PAY_TWO_ENERGY_DISCARD_LOOK_TOP_FIVE_LIELLA_ABILITY_ID,
    });
    expect(
      context.session.state?.pendingAbilities.some(
        (ability) =>
          ability.abilityId ===
          SP_BP5_005_AUTO_MAIN_PHASE_CARD_ENTER_WAITING_ROOM_PAY_ENERGY_RECOVER_ABILITY_ID
      )
    ).toBe(true);
    const beforeFinish = context.session.state!.actionHistory.length;
    expect(confirm(context).success).toBe(true);
    const finishIndex = context.session.state!.actionHistory.findIndex(
      (action, index) =>
        index >= beforeFinish &&
        action.type === 'RESOLVE_ABILITY' &&
        action.payload.abilityId ===
          SP_BP1_010_ACTIVATED_PAY_TWO_ENERGY_DISCARD_LOOK_TOP_FIVE_LIELLA_ABILITY_ID &&
        action.payload.step === 'TAKE_LIELLA_CARD_REST_TO_WAITING_ROOM'
    );
    const watcherResolutionIndex = context.session.state!.actionHistory.findIndex(
      (action, index) =>
        index >= beforeFinish &&
        action.type === 'RESOLVE_ABILITY' &&
        action.payload.abilityId ===
          SP_BP5_005_AUTO_MAIN_PHASE_CARD_ENTER_WAITING_ROOM_PAY_ENERGY_RECOVER_ABILITY_ID
    );
    expect(finishIndex).toBeGreaterThanOrEqual(0);
    expect(watcherResolutionIndex).toBeGreaterThan(finishIndex);
  });
});

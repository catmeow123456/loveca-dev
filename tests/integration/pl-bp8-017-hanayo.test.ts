import { describe, expect, it } from 'vitest';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
  type AnyCardData,
  type MemberCardData,
} from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import { placeCardInSlot, removeCardFromSlot } from '../../src/domain/entities/zone';
import {
  createAutoAdvancePublicRevealCommand,
  createConfirmEffectStepCommand,
  createPlayMemberToSlotCommand,
} from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import {
  PL_BP8_017_ON_ENTER_REVEAL_NO_BLADE_HEART_MEMBER_BOTTOM_LOOK_FIVE_MUSE_ABILITY_ID,
  SP_BP5_005_AUTO_MAIN_PHASE_CARD_ENTER_WAITING_ROOM_PAY_ENERGY_RECOVER_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import { findCardAbilityDefinitionById } from '../../src/application/card-effects/definitions/lookup';
import { PUBLIC_REVEAL_DWELL_STEP_ID } from '../../src/application/card-effects/runtime/public-reveal-dwell';
import { createPublicObjectId, projectPlayerViewState } from '../../src/online/projector';
import {
  BladeHeartEffect,
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
const ABILITY_ID =
  PL_BP8_017_ON_ENTER_REVEAL_NO_BLADE_HEART_MEMBER_BOTTOM_LOOK_FIVE_MUSE_ABILITY_ID;
const EFFECT_TEXT =
  '【登场】可以将手牌的1张不持有BLADE HEART的成员卡公开：将因此公开的卡片放置于自己的卡组底。此后，检视自己的卡组顶的5张卡片。可以将其中的1张『μ’s』的卡片公开并加入手牌。其余的放置入休息室。';
const REVEAL_HAND = 'PL_BP8_017_REVEAL_NO_BLADE_HEART_HAND_MEMBER';
const SELECT_MUSE = 'PL_BP8_017_SELECT_INSPECTED_MUSE_CARD';

function member(cardCode: string, groupNames: readonly string[] = ['μ’s']): MemberCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames,
    cardType: CardType.MEMBER,
    cost: 11,
    blade: 4,
    hearts: [createHeartIcon(HeartColor.YELLOW, 1)],
  };
}
function card(data: AnyCardData, id: string, ownerId = P1) {
  return createCardInstance(data, ownerId, id);
}
function live(id: string, groups = ['μ’s']) {
  return card(
    {
      cardCode: id,
      name: id,
      cardType: CardType.LIVE,
      groupNames: groups,
      score: 1,
      requirements: createHeartRequirement({ [HeartColor.YELLOW]: 1 }),
    },
    id
  );
}
function setup(
  options: {
    readonly sourceCode?: string;
    readonly hand?: readonly ReturnType<typeof card>[];
    readonly deck?: readonly ReturnType<typeof card>[];
    readonly waiting?: readonly ReturnType<typeof card>[];
    readonly watcher?: boolean;
  } = {}
) {
  let now = 10_000;
  const session = createGameSession({ now: () => now });
  session.createGame('pl-bp8-017', P1, 'P1', P2, 'P2');
  const source = card(member(options.sourceCode ?? 'PL!-bp8-017-N'), 'hanayo');
  const cost = card(member('COST', ['Aqours']), 'cost');
  const hand = options.hand ?? [cost];
  const deck = options.deck ?? [
    card(member('TOP-MUSE', ['μ’s']), 'top-muse'),
    live('top-live', ["μ's"]),
    card(member('TOP-OTHER', ['Aqours']), 'top-other'),
    card(member('TOP-MUSE-STRAIGHT', ["μ's"]), 'top-muse-straight'),
    live('top-other-live', ['蓮ノ空']),
    card(member('FILLER'), 'filler'),
  ];
  const waiting = options.waiting ?? [];
  const watcher = options.watcher ? card(member('PL!SP-bp5-005-P', ['Liella!']), 'watcher') : null;
  let game = registerCards(createGameState('pl-bp8-017', P1, 'P1', P2, 'P2'), [
    source,
    ...hand,
    ...deck,
    ...waiting,
    ...(watcher ? [watcher] : []),
  ]);
  game = {
    ...game,
    currentPhase: GamePhase.MAIN_PHASE,
    currentSubPhase: SubPhase.MAIN_FREE,
    currentTurnType: TurnType.NORMAL,
    activePlayerIndex: 0,
    waitingPlayerId: null,
  };
  game = updatePlayer(game, P1, (player) => ({
    ...player,
    hand: {
      ...player.hand,
      cardIds: [source.instanceId, ...hand.map((entry) => entry.instanceId)],
    },
    mainDeck: { ...player.mainDeck, cardIds: deck.map((entry) => entry.instanceId) },
    waitingRoom: { ...player.waitingRoom, cardIds: waiting.map((entry) => entry.instanceId) },
    memberSlots: watcher
      ? placeCardInSlot(player.memberSlots, SlotPosition.LEFT, watcher.instanceId, {
          face: FaceState.FACE_UP,
          orientation: OrientationState.ACTIVE,
        })
      : player.memberSlots,
  }));
  function setState(state: GameState) {
    (session as unknown as { authorityState: GameState }).authorityState = state;
  }
  setState(game);
  session.setManualOperationMode('FREE');
  const played = session.executeCommand(
    createPlayMemberToSlotCommand(P1, source.instanceId, SlotPosition.CENTER, { freePlay: true })
  );
  expect(played.success, played.error).toBe(true);
  return {
    session,
    source,
    cost: hand[0],
    hand,
    deck,
    watcher,
    setState,
    setNow: (value: number) => {
      now = value;
    },
  };
}
type Scenario = ReturnType<typeof setup>;
function select(scenario: Scenario, selectedCardId: string | null) {
  return scenario.session.executeCommand(
    createConfirmEffectStepCommand(P1, scenario.session.state!.activeEffect!.id, selectedCardId)
  );
}
function revealAdvanceCommand(scenario: Scenario, playerId = P2) {
  const effect = scenario.session.state!.activeEffect!;
  expect(effect.stepId).toBe(PUBLIC_REVEAL_DWELL_STEP_ID);
  return createAutoAdvancePublicRevealCommand(
    playerId,
    effect.id,
    effect.publicRevealAutoAdvanceAt!,
    effect.publicRevealGeneration!
  );
}
function advance(scenario: Scenario) {
  const command = revealAdvanceCommand(scenario);
  scenario.setNow(command.publicRevealAutoAdvanceAt!);
  const result = scenario.session.executeCommand(command);
  expect(result.success, result.error).toBe(true);
  return command;
}
function inspect(scenario: Scenario) {
  const paid = select(scenario, scenario.cost!.instanceId);
  expect(paid.success, paid.error).toBe(true);
  advance(scenario);
}
function waitingEvents(state: GameState, fromZone: ZoneType) {
  return state.eventLog
    .map((entry) => entry.event)
    .filter(
      (event) =>
        event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM && event.fromZone === fromZone
    );
}

describe('PL!-bp8-017 费用11 小泉花阳', () => {
  it.each(['PL!-bp8-017-N', 'PL!-bp8-017-P+', 'PL!-bp8-017-SEC'])(
    'uses the real ON_ENTER path and full Chinese text for %s',
    (sourceCode) => {
      const scenario = setup({ sourceCode });
      expect(findCardAbilityDefinitionById(ABILITY_ID)?.effectText).toBe(EFFECT_TEXT);
      expect(scenario.session.state!.activeEffect).toMatchObject({
        abilityId: ABILITY_ID,
        sourceCardId: scenario.source.instanceId,
        stepId: REVEAL_HAND,
        effectText: EFFECT_TEXT,
        confirmSelectionLabel: '公开',
        skipSelectionLabel: '不发动',
      });
      expect(
        scenario.session.state!.actionHistory.find(
          (action) => action.type === 'TRIGGER_ABILITY' && action.payload.abilityId === ABILITY_ID
        )?.payload
      ).toMatchObject({
        sourceCardId: scenario.source.instanceId,
        timingId: TriggerCondition.ON_ENTER_STAGE,
        sourceSlot: SlotPosition.CENTER,
      });
    }
  );

  it('offers only owned hand members without any BLADE HEART, independently of group and ordinary blade', () => {
    const plain = card({ ...member('PLAIN', ['Aqours']), bladeHearts: [] }, 'plain');
    const missing = card(member('MISSING', ['蓮ノ空']), 'missing');
    const heart = card(
      {
        ...member('HEART'),
        bladeHearts: [{ effect: BladeHeartEffect.HEART, heartColor: HeartColor.GRAY }],
      },
      'heart'
    );
    const draw = card(
      { ...member('DRAW'), bladeHearts: [{ effect: BladeHeartEffect.DRAW }] },
      'draw'
    );
    const score = card(
      { ...member('SCORE'), bladeHearts: [{ effect: BladeHeartEffect.SCORE }] },
      'score'
    );
    const otherOwner = card(member('OTHER-OWNER'), 'other-owner', P2);
    const scenario = setup({
      hand: [plain, missing, heart, draw, score, live('live-cost'), otherOwner],
    });
    expect(scenario.session.state!.activeEffect?.selectableCardIds).toEqual(['plain', 'missing']);
    const view = projectPlayerViewState(scenario.session.state!, P2);
    expect(view.activeEffect?.selectableObjectIds).toBeUndefined();
    expect(JSON.stringify(view)).not.toContain('PLAIN');
    expect(select(scenario, heart.instanceId).success).toBe(false);
    expect(scenario.session.state!.actionHistory.some((action) => action.type === 'PAY_COST')).toBe(
      false
    );
  });

  it('pays only the reveal before dwell, then places the cost on bottom before inspecting', () => {
    const scenario = setup();
    const originalDeck = [...scenario.session.state!.players[0].mainDeck.cardIds];
    expect(select(scenario, scenario.cost!.instanceId).success).toBe(true);
    const revealed = scenario.session.state!;
    expect(revealed.players[0].hand.cardIds).toContain(scenario.cost!.instanceId);
    expect(revealed.players[0].mainDeck.cardIds).toEqual(originalDeck);
    expect(revealed.inspectionZone.cardIds).toEqual([]);
    expect(
      revealed.actionHistory.filter(
        (action) => action.type === 'PAY_COST' && action.payload.abilityId === ABILITY_ID
      )
    ).toHaveLength(1);
    for (const playerId of [P1, P2]) {
      const view = projectPlayerViewState(revealed, playerId);
      expect(view.activeEffect?.revealedObjectIds).toEqual([
        createPublicObjectId(scenario.cost!.instanceId),
      ]);
      expect(view.objects[createPublicObjectId(scenario.cost!.instanceId)]?.surface).toBe('FRONT');
    }
    const command = revealAdvanceCommand(scenario);
    expect(scenario.session.executeCommand(command).success).toBe(false);
    expect(
      scenario.session.executeCommand({ ...command, publicRevealGeneration: 'old-generation' })
        .success
    ).toBe(false);
    const afterEarly = scenario.session.state!;
    expect(afterEarly.inspectionZone.cardIds).toEqual([]);
    scenario.setNow(command.publicRevealAutoAdvanceAt!);
    expect(scenario.session.executeCommand(command).success).toBe(true);
    expect(scenario.session.state!.activeEffect?.stepId).toBe(SELECT_MUSE);
    expect(scenario.session.state!.players[0].mainDeck.cardIds).toEqual([
      'filler',
      scenario.cost!.instanceId,
    ]);
    expect(scenario.session.state!.players[0].hand.cardIds).not.toContain(
      scenario.cost!.instanceId
    );
    expect(scenario.session.executeCommand(command).success).toBe(false);
    expect(waitingEvents(scenario.session.state!, ZoneType.HAND)).toEqual([]);
  });

  it('accepts a μ’s LIVE, reveals only it, and discards the rest as one exact event batch after dwell', () => {
    const scenario = setup();
    inspect(scenario);
    expect(scenario.session.state!.activeEffect?.selectableCardIds).toEqual([
      'top-muse',
      'top-live',
      'top-muse-straight',
    ]);
    for (const playerId of [P1, P2]) {
      const view = projectPlayerViewState(scenario.session.state!, playerId);
      expect(view.objects[createPublicObjectId('top-live')]?.surface).toBe(
        playerId === P1 ? 'FRONT' : 'BACK'
      );
    }
    expect(select(scenario, 'top-live').success).toBe(true);
    const revealing = scenario.session.state!;
    expect(revealing.activeEffect?.stepId).toBe(PUBLIC_REVEAL_DWELL_STEP_ID);
    expect(revealing.inspectionZone.revealedCardIds).toEqual(['top-live']);
    expect(revealing.players[0].hand.cardIds).not.toContain('top-live');
    expect(revealing.players[0].waitingRoom.cardIds).toEqual([]);
    const view = projectPlayerViewState(revealing, P2);
    expect(view.objects[createPublicObjectId('top-live')]?.surface).toBe('FRONT');
    expect(view.objects[createPublicObjectId('top-muse')]?.surface).toBe('BACK');
    advance(scenario);
    expect(scenario.session.state!.players[0].hand.cardIds).toEqual(['top-live']);
    expect(scenario.session.state!.players[0].waitingRoom.cardIds).toEqual([
      'top-muse',
      'top-other',
      'top-muse-straight',
      'top-other-live',
    ]);
    expect(scenario.session.state!.inspectionZone.cardIds).toEqual([]);
    expect(waitingEvents(scenario.session.state!, ZoneType.MAIN_DECK)).toMatchObject([
      {
        cardInstanceIds: ['top-muse', 'top-other', 'top-muse-straight', 'top-other-live'],
        toZone: ZoneType.WAITING_ROOM,
        cause: { sourceCardId: scenario.source.instanceId, abilityId: ABILITY_ID },
      },
    ]);
  });

  it('declines before paying, and consumes the pending without inspecting when no legal cost exists', () => {
    const scenario = setup();
    const before = scenario.session.state!;
    expect(select(scenario, null).success).toBe(true);
    expect(scenario.session.state!.players[0].hand.cardIds).toEqual(before.players[0].hand.cardIds);
    expect(scenario.session.state!.players[0].mainDeck.cardIds).toEqual(
      before.players[0].mainDeck.cardIds
    );
    expect(scenario.session.state!.activeEffect).toBeNull();
    const impossible = setup({ hand: [live('live-only')] });
    expect(impossible.session.state!.activeEffect).toBeNull();
    expect(impossible.session.state!.inspectionZone.cardIds).toEqual([]);
    expect(impossible.session.state!.pendingAbilities).toEqual([]);
  });

  it('preserves a no-target inspection window until the player sends every inspected card to waiting', () => {
    const scenario = setup({
      deck: [
        card(member('OTHER', ['Aqours']), 'other'),
        live('other-live', ['蓮ノ空']),
        card(member('FILLER', ['Aqours']), 'other-filler'),
      ],
    });
    inspect(scenario);
    expect(scenario.session.state!.activeEffect).toMatchObject({
      selectableCardIds: [],
      skipSelectionLabel: '全部放置入休息室',
    });
    expect(scenario.session.state!.inspectionZone.cardIds.length).toBeGreaterThan(0);
    expect(scenario.session.state!.players[0].waitingRoom.cardIds).toEqual([]);
    const inspected = [...scenario.session.state!.inspectionZone.cardIds];
    expect(select(scenario, null).success).toBe(true);
    expect(waitingEvents(scenario.session.state!, ZoneType.MAIN_DECK)).toMatchObject([
      { cardInstanceIds: inspected },
    ]);
  });

  it('does not cancel paid costs or independent deck operations when the source leaves the stage', () => {
    const scenario = setup();
    scenario.setState(
      updatePlayer(scenario.session.state!, P1, (player) => ({
        ...player,
        memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.CENTER),
      }))
    );
    expect(select(scenario, scenario.cost!.instanceId).success).toBe(true);
    advance(scenario);
    expect(select(scenario, 'top-muse').success).toBe(true);
    advance(scenario);
    expect(scenario.session.state!.players[0].hand.cardIds).toEqual(['top-muse']);
  });

  it('rejects stale costs, oversized selections, changed groups and stale inspected targets', () => {
    const scenario = setup();
    const initial = scenario.session.state!;
    scenario.setState(
      updatePlayer(initial, P1, (player) => ({ ...player, hand: { ...player.hand, cardIds: [] } }))
    );
    expect(select(scenario, scenario.cost!.instanceId).success).toBe(false);
    expect(scenario.session.state!.activeEffect?.stepId).toBe(REVEAL_HAND);
    scenario.setState(initial);
    scenario.setState(
      registerCards(initial, [
        card(
          {
            ...(scenario.cost!.data as MemberCardData),
            bladeHearts: [{ effect: BladeHeartEffect.DRAW }],
          },
          scenario.cost!.instanceId
        ),
      ])
    );
    expect(select(scenario, scenario.cost!.instanceId).success).toBe(false);
    scenario.setState(initial);
    inspect(scenario);
    const inspected = scenario.session.state!;
    expect(
      scenario.session.executeCommand(
        createConfirmEffectStepCommand(
          P1,
          inspected.activeEffect!.id,
          undefined,
          undefined,
          undefined,
          undefined,
          ['top-muse', 'top-live']
        )
      ).success
    ).toBe(false);
    expect(select(scenario, 'top-other').success).toBe(false);
    scenario.setState(registerCards(inspected, [card(member('TOP-MUSE', ['Aqours']), 'top-muse')]));
    expect(select(scenario, 'top-muse').success).toBe(false);
    scenario.setState({
      ...inspected,
      inspectionZone: {
        ...inspected.inspectionZone,
        cardIds: inspected.inspectionZone.cardIds.filter((id) => id !== 'top-live'),
      },
    });
    expect(select(scenario, 'top-live').success).toBe(false);
    expect(scenario.session.state!.activeEffect?.stepId).toBe(SELECT_MUSE);
  });

  it('revalidates a selected card after its reveal and preserves the paid cost when the selection becomes stale', () => {
    const scenario = setup();
    inspect(scenario);
    expect(select(scenario, 'top-live').success).toBe(true);
    scenario.setState(registerCards(scenario.session.state!, [live('top-live', ['Aqours'])]));
    const command = revealAdvanceCommand(scenario);
    scenario.setNow(command.publicRevealAutoAdvanceAt!);
    expect(scenario.session.executeCommand(command).success).toBe(true);
    expect(scenario.session.state!.activeEffect?.stepId).toBe(
      'PL_BP8_017_REVEAL_SELECTED_MUSE_CARD'
    );
    expect(scenario.session.state!.players[0].hand.cardIds).not.toContain(
      scenario.cost!.instanceId
    );
    expect(scenario.session.state!.players[0].waitingRoom.cardIds).toEqual([]);
  });

  it('continues inspection without undoing the paid reveal when the revealed cost is no longer in hand', () => {
    const scenario = setup();
    expect(select(scenario, scenario.cost!.instanceId).success).toBe(true);
    scenario.setState(
      updatePlayer(scenario.session.state!, P1, (player) => ({
        ...player,
        hand: {
          ...player.hand,
          cardIds: player.hand.cardIds.filter((id) => id !== scenario.cost!.instanceId),
        },
        waitingRoom: { ...player.waitingRoom, cardIds: [scenario.cost!.instanceId] },
      }))
    );
    advance(scenario);
    expect(scenario.session.state!.activeEffect?.stepId).toBe(SELECT_MUSE);
    expect(
      scenario.session.state!.actionHistory.find(
        (action) => action.payload.step === 'PLACE_REVEALED_MEMBER_TO_DECK_BOTTOM'
      )?.payload.movedCardIds
    ).toEqual([]);
    expect(
      scenario.session.state!.actionHistory.filter(
        (action) => action.type === 'PAY_COST' && action.payload.abilityId === ABILITY_ID
      )
    ).toHaveLength(1);
    expect(select(scenario, 'top-live').success).toBe(true);
    advance(scenario);
    expect(scenario.session.state!.activeEffect).toBeNull();
    expect(scenario.session.state!.players[0].hand.cardIds).toEqual(['top-live']);
  });

  it('handles a short deck after the bottom placement, including the cost itself in the real inspection', () => {
    const scenario = setup({ deck: [card(member('ONE'), 'one')], waiting: [] });
    inspect(scenario);
    expect(scenario.session.state!.activeEffect?.inspectionCardIds).toEqual([
      'one',
      scenario.cost!.instanceId,
    ]);
    expect(select(scenario, null).success).toBe(true);
    expect(waitingEvents(scenario.session.state!, ZoneType.MAIN_DECK)).toMatchObject([
      { cardInstanceIds: ['one', scenario.cost!.instanceId] },
    ]);
    expect(new Set(scenario.session.state!.players[0].mainDeck.cardIds)).toEqual(
      new Set(['one', scenario.cost!.instanceId])
    );
  });

  it('keeps inspection-triggered pending abilities in unified continuation without inserting them mid-effect', () => {
    const scenario = setup({ watcher: true });
    inspect(scenario);
    expect(select(scenario, 'top-live').success).toBe(true);
    expect(
      scenario.session.state!.actionHistory.some(
        (action) =>
          action.type === 'TRIGGER_ABILITY' &&
          action.payload.abilityId ===
            SP_BP5_005_AUTO_MAIN_PHASE_CARD_ENTER_WAITING_ROOM_PAY_ENERGY_RECOVER_ABILITY_ID
      )
    ).toBe(false);
    advance(scenario);
    expect(
      scenario.session.state!.actionHistory.some(
        (action) =>
          action.type === 'TRIGGER_ABILITY' &&
          action.payload.abilityId ===
            SP_BP5_005_AUTO_MAIN_PHASE_CARD_ENTER_WAITING_ROOM_PAY_ENERGY_RECOVER_ABILITY_ID &&
          action.payload.sourceCardId === scenario.watcher!.instanceId
      )
    ).toBe(true);
    expect(
      scenario.session.state!.activeEffect?.abilityId ===
        SP_BP5_005_AUTO_MAIN_PHASE_CARD_ENTER_WAITING_ROOM_PAY_ENERGY_RECOVER_ABILITY_ID ||
        scenario.session.state!.pendingAbilities.some(
          (ability) =>
            ability.abilityId ===
            SP_BP5_005_AUTO_MAIN_PHASE_CARD_ENTER_WAITING_ROOM_PAY_ENERGY_RECOVER_ABILITY_ID
        )
    ).toBe(true);
  });
});

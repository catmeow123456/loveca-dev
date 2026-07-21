import { describe, expect, it } from 'vitest';
import type { MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import {
  createGameState,
  emitGameEvent,
  registerCards,
  updatePlayer,
  type GameState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { createEnterStageEvent } from '../../src/domain/events/game-events';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import {
  confirmActiveEffectStep,
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  S_BP7_003_LIVE_START_LOOK_TOP_ONE_OPTIONAL_BOTTOM_ABILITY_ID,
  S_BP7_003_ON_ENTER_CHOOSE_WAIT_PROTECTION_OR_POSITION_CHANGE_ABILITY_ID,
  S_BP7_003_ON_ENTER_LOOK_TOP_ONE_OPTIONAL_BOTTOM_ABILITY_ID,
  PL_BP5_013_ON_ENTER_WAIT_OPPONENT_COST_LTE_FOUR_MEMBER_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import { getCardAbilityDefinitionsForCardCode } from '../../src/application/card-effects/definitions/lookup';
import { continuePublicEffectChoiceForTest } from '../helpers/public-effect-choice';
import {
  CardAbilityCategory,
  CardAbilitySourceZone,
} from '../../src/application/card-effects/ability-definition-types';
import {
  setMemberOrientation,
  setMembersOrientation,
} from '../../src/application/effects/member-state';
import { moveMemberBetweenSlots } from '../../src/application/effects/member-state';
import { addMemberWaitProtectionUntilLiveEnd } from '../../src/domain/rules/member-wait-protections';
import { projectPlayerViewState } from '../../src/online/projector';
import { GameService } from '../../src/application/game-service';
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

const P1 = 'p1';
const P2 = 'p2';
const SOURCE_ID = 'kanan-source';
const TOP_ID = 'top-card';
const SECOND_ID = 'second-card';
const WAITING_ID = 'refresh-card';
const LOOK_ENTER = S_BP7_003_ON_ENTER_LOOK_TOP_ONE_OPTIONAL_BOTTOM_ABILITY_ID;
const LOOK_LIVE = S_BP7_003_LIVE_START_LOOK_TOP_ONE_OPTIONAL_BOTTOM_ABILITY_ID;
const CHOOSE = S_BP7_003_ON_ENTER_CHOOSE_WAIT_PROTECTION_OR_POSITION_CHANGE_ABILITY_ID;

function member(
  cardCode: string,
  ownerId = P1,
  options: { readonly blade?: number; readonly groups?: readonly string[] } = {}
) {
  const data: MemberCardData = {
    cardCode,
    name: cardCode,
    groupNames: options.groups ?? ['Aqours'],
    cardType: CardType.MEMBER,
    cost: 4,
    blade: options.blade ?? 2,
    hearts: [createHeartIcon(HeartColor.BLUE, 1)],
  };
  return createCardInstance(data, ownerId, cardCode === 'PL!S-bp7-003-SEC' ? SOURCE_ID : cardCode);
}

function pending(abilityId: string, id = `pending:${abilityId}`): PendingAbilityState {
  return {
    id,
    abilityId,
    sourceCardId: SOURCE_ID,
    controllerId: P1,
    mandatory: true,
    timingId:
      abilityId === LOOK_LIVE ? TriggerCondition.ON_LIVE_START : TriggerCondition.ON_ENTER_STAGE,
    sourceSlot: SlotPosition.CENTER,
  };
}

function putStage(
  game: GameState,
  playerId: string,
  slot: SlotPosition,
  cardId: string,
  orientation = OrientationState.ACTIVE
): GameState {
  return updatePlayer(game, playerId, (player) => ({
    ...player,
    memberSlots: placeCardInSlot(player.memberSlots, slot, cardId, {
      orientation,
      face: FaceState.FACE_UP,
    }),
  }));
}

function setupLook(
  abilityId: string,
  options: {
    readonly mainDeck?: readonly string[];
    readonly waitingRoom?: readonly string[];
  } = {}
): GameState {
  const cards = [member('PL!S-bp7-003-SEC'), member(TOP_ID), member(SECOND_ID), member(WAITING_ID)];
  let game = registerCards(createGameState('s003-look', P1, 'P1', P2, 'P2'), cards);
  game = putStage(game, P1, SlotPosition.CENTER, SOURCE_ID);
  game = updatePlayer(game, P1, (player) => ({
    ...player,
    mainDeck: { ...player.mainDeck, cardIds: [...(options.mainDeck ?? [TOP_ID, SECOND_ID])] },
    waitingRoom: { ...player.waitingRoom, cardIds: [...(options.waitingRoom ?? [])] },
  }));
  return { ...game, pendingAbilities: [pending(abilityId)] };
}

function start(game: GameState): GameState {
  return resolvePendingCardEffects(game).gameState;
}

function chooseOption(game: GameState, optionId: string | null, playerId = P1): GameState {
  const normalizedOptionId =
    optionId === null &&
    game.activeEffect?.effectChoice?.options.some((option) => option.id === 'keep-top')
      ? 'keep-top'
      : optionId;
  return continuePublicEffectChoiceForTest(confirmActiveEffectStep(
    game,
    playerId,
    game.activeEffect!.id,
    undefined,
    undefined,
    undefined,
    normalizedOptionId
  ), playerId);
}

function chooseSlot(game: GameState, slot: SlotPosition): GameState {
  return confirmActiveEffectStep(game, P1, game.activeEffect!.id, undefined, slot);
}

function protectedGame(targets: readonly ReturnType<typeof member>[]): GameState {
  let game = registerCards(createGameState('s003-protection', P1, 'P1', P2, 'P2'), [
    member('PL!S-bp7-003-SEC'),
    ...targets,
  ]);
  game = putStage(game, P1, SlotPosition.CENTER, SOURCE_ID);
  targets.slice(0, 3).forEach((target, index) => {
    game = putStage(
      game,
      P1,
      [SlotPosition.LEFT, SlotPosition.RIGHT, SlotPosition.CENTER][index]!,
      target.instanceId
    );
  });
  return addMemberWaitProtectionUntilLiveEnd(game, {
    affectedPlayerId: P1,
    sourceCardId: SOURCE_ID,
    abilityId: CHOOSE,
  });
}

describe('PL!S-bp7-003-SEC 费用4「松浦果南」 definitions', () => {
  it('registers three exact queued implemented identities with two ON_ENTER and one LIVE_START', () => {
    const definitions = getCardAbilityDefinitionsForCardCode('PL!S-bp7-003-SEC');
    expect(definitions).toHaveLength(3);
    expect(definitions.map((definition) => definition.abilityId)).toEqual([
      LOOK_ENTER,
      LOOK_LIVE,
      CHOOSE,
    ]);
    expect(new Set(definitions.map((definition) => definition.abilityId)).size).toBe(3);
    expect(definitions).toEqual([
      expect.objectContaining({
        cardCodes: ['PL!S-bp7-003-SEC'],
        category: CardAbilityCategory.ON_ENTER,
        sourceZone: CardAbilitySourceZone.PLAYED_MEMBER,
        triggerCondition: TriggerCondition.ON_ENTER_STAGE,
        queued: true,
        implemented: true,
        effectText: '【登场】检视自己的卡组顶的卡片。可以将其放置于卡组底。',
      }),
      expect.objectContaining({
        cardCodes: ['PL!S-bp7-003-SEC'],
        category: CardAbilityCategory.LIVE_START,
        sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
        triggerCondition: TriggerCondition.ON_LIVE_START,
        queued: true,
        implemented: true,
      }),
      expect.objectContaining({
        cardCodes: ['PL!S-bp7-003-SEC'],
        category: CardAbilityCategory.ON_ENTER,
        sourceZone: CardAbilitySourceZone.PLAYED_MEMBER,
        triggerCondition: TriggerCondition.ON_ENTER_STAGE,
        queued: true,
        implemented: true,
      }),
    ]);
    expect(definitions.every((definition) => definition.baseCardCodes === undefined)).toBe(true);
    for (const code of [
      'PL!S-bp7-003-P',
      'PL!S-bp7-003-R',
      'PL!S-bp7-002-SEC',
      'PL!S-bp7-004-SEC',
    ]) {
      expect(getCardAbilityDefinitionsForCardCode(code)).toEqual([]);
    }
  });
});

describe('PL!S-bp7-003-SEC private top-one inspection', () => {
  for (const abilityId of [LOOK_ENTER, LOOK_LIVE]) {
    it(`${abilityId} keeps the inspected card on top with governed copy and private projection`, () => {
      const waiting = start(setupLook(abilityId));
      expect(waiting.activeEffect).toMatchObject({
        abilityId,
        stepText: '查看卡组顶1张卡。可以将其放置于卡组底。',
        inspectionCardIds: [TOP_ID],
        effectChoice: {
          mode: 'SINGLE',
          options: [
            { id: 'keep-top', text: '将检视的卡保留在卡组顶。' },
            { id: 'place-bottom', text: '将检视的卡放置于卡组底。' },
          ],
        },
        confirmSelectionLabel: '确定',
      });
      expect(waiting.inspectionZone.revealedCardIds).toEqual([]);
      const ownView = projectPlayerViewState(waiting, P1);
      const opponentView = projectPlayerViewState(waiting, P2);
      expect(ownView.activeEffect?.inspectionObjectIds).toHaveLength(1);
      expect(opponentView.activeEffect?.inspectionObjectIds).toBeUndefined();
      const opponentInspection = opponentView.table.zones.FIRST_INSPECTION_ZONE.objectIds?.[0];
      expect(
        opponentInspection ? opponentView.objects[opponentInspection]?.surface : undefined
      ).toBe('BACK');
      expect(
        opponentInspection ? opponentView.objects[opponentInspection]?.frontInfo : undefined
      ).toBeUndefined();

      const done = chooseOption(waiting, null);
      expect(done.players[0].mainDeck.cardIds).toEqual([TOP_ID, SECOND_ID]);
      expect(done.inspectionZone.cardIds).toEqual([]);
      expect(done.activeEffect).toBeNull();
      expect(done.eventLog).toHaveLength(0);
    });

    it(`${abilityId} moves only within MAIN_DECK to the bottom without public/waiting events`, () => {
      const done = chooseOption(start(setupLook(abilityId)), 'place-bottom');
      expect(done.players[0].mainDeck.cardIds).toEqual([SECOND_ID, TOP_ID]);
      expect(done.players[0].waitingRoom.cardIds).toEqual([]);
      expect(done.inspectionZone.cardIds).toEqual([]);
      expect(done.inspectionZone.revealedCardIds).toEqual([]);
      expect(done.eventLog).toHaveLength(0);
    });
  }

  it('uses standard refresh for an empty main deck and preserves one-card post-inspection refresh top/bottom semantics', () => {
    const refreshed = start(
      setupLook(LOOK_ENTER, { mainDeck: [], waitingRoom: [TOP_ID, WAITING_ID] })
    );
    expect(refreshed.activeEffect?.inspectionCardIds).toHaveLength(1);
    expect(refreshed.players[0].waitingRoom.cardIds).toEqual([]);

    for (const optionId of [null, 'place-bottom'] as const) {
      const waiting = start(
        setupLook(LOOK_ENTER, { mainDeck: [TOP_ID], waitingRoom: [WAITING_ID, SECOND_ID] })
      );
      expect(waiting.players[0].mainDeck.cardIds).toHaveLength(2);
      const done = chooseOption(waiting, optionId);
      expect(done.players[0].mainDeck.cardIds).toHaveLength(3);
      expect(new Set(done.players[0].mainDeck.cardIds)).toEqual(
        new Set([TOP_ID, WAITING_ID, SECOND_ID])
      );
      expect(
        optionId === null
          ? done.players[0].mainDeck.cardIds[0]
          : done.players[0].mainDeck.cardIds.at(-1)
      ).toBe(TOP_ID);
    }
  });

  it('safely consumes an empty deck+waiting room pending without an empty window', () => {
    const done = start(setupLook(LOOK_ENTER, { mainDeck: [], waitingRoom: [] }));
    expect(done.pendingAbilities).toEqual([]);
    expect(done.activeEffect).toBeNull();
    expect(done.actionHistory.at(-1)?.payload.step).toBe('NO_TOP_CARD_TO_INSPECT');
  });

  it('keeps the window and cards unchanged for forged/stale input and is idempotent after success', () => {
    const waiting = start(setupLook(LOOK_ENTER));
    expect(chooseOption(waiting, 'forged')).toBe(waiting);
    const stale = {
      ...waiting,
      inspectionContext: { ownerPlayerId: P2, sourceZone: ZoneType.MAIN_DECK },
    };
    const staleResult = chooseOption(stale, 'place-bottom');
    expect(staleResult).toStrictEqual(stale);
    expect(staleResult.players[0].mainDeck.cardIds).toEqual([SECOND_ID]);
    expect(staleResult.inspectionZone.cardIds).toEqual([TOP_ID]);

    const done = chooseOption(waiting, 'place-bottom');
    const repeated = confirmActiveEffectStep(
      done,
      P1,
      waiting.activeEffect!.id,
      undefined,
      undefined,
      undefined,
      'place-bottom'
    );
    expect(repeated).toBe(done);
    expect(repeated.players[0].mainDeck.cardIds.filter((id) => id === TOP_ID)).toHaveLength(1);
  });

  it('still resolves after the source leaves once the pending inspection started', () => {
    const waiting = start(setupLook(LOOK_ENTER));
    const sourceLeft = updatePlayer(waiting, P1, (player) => ({
      ...player,
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, null),
    }));
    const done = chooseOption(sourceLeft, null);
    expect(done.players[0].mainDeck.cardIds[0]).toBe(TOP_ID);
    expect(done.activeEffect).toBeNull();
  });
});

describe('PL!S-bp7-003-SEC simultaneous ON_ENTER ordering', () => {
  it('a real ON_ENTER event queues two independent abilities and either can be chosen first', () => {
    let game = setupLook(LOOK_ENTER);
    game = { ...game, pendingAbilities: [] };
    const enter = createEnterStageEvent(SOURCE_ID, ZoneType.HAND, SlotPosition.CENTER, P1, P1);
    game = emitGameEvent(game, enter);
    game = enqueueTriggeredCardEffects(game, [TriggerCondition.ON_ENTER_STAGE], {
      onEnterStageSources: [
        {
          cardId: SOURCE_ID,
          playerId: P1,
          sourceSlot: SlotPosition.CENTER,
          eventId: enter.eventId,
        },
      ],
    });
    expect(game.pendingAbilities.map((ability) => ability.abilityId)).toEqual([LOOK_ENTER, CHOOSE]);

    const order = start(game);
    expect(order.activeEffect?.selectableOptions).toHaveLength(2);
    const lookPendingId = order.pendingAbilities.find(
      (ability) => ability.abilityId === LOOK_ENTER
    )!.id;
    const lookFirst = chooseOption(order, lookPendingId);
    expect(lookFirst.activeEffect?.abilityId).toBe(LOOK_ENTER);
    const afterLook = chooseOption(lookFirst, null);
    expect(afterLook.activeEffect?.abilityId).toBe(CHOOSE);

    const order2 = start(game);
    const choosePendingId = order2.pendingAbilities.find(
      (ability) => ability.abilityId === CHOOSE
    )!.id;
    const branchFirst = chooseOption(order2, choosePendingId);
    expect(branchFirst.activeEffect?.abilityId).toBe(CHOOSE);
    const afterBranch = chooseOption(branchFirst, 'protect-aqours');
    expect(afterBranch.activeEffect?.abilityId).toBe(LOOK_ENTER);
  });
});

describe('member wait protection rule boundary', () => {
  it('protects current top-level printed BLADE 0..3 Aqours dynamically, but not blade 4/non-Aqours/memberBelow', () => {
    for (const blade of [0, 1, 2, 3]) {
      const target = member(`aqours-${blade}`, P1, { blade });
      const game = protectedGame([target]);
      const result = setMemberOrientation(game, P1, target.instanceId, OrientationState.WAITING, {
        kind: 'CARD_EFFECT',
        playerId: P2,
        sourceCardId: 'opponent-effect',
      });
      expect(result).toMatchObject({ changed: false, blockedByWaitingProtection: true });
      expect(result?.gameState.eventLog).toHaveLength(0);
    }

    for (const target of [
      member('aqours-4', P1, { blade: 4 }),
      member('not-aqours', P1, { blade: 2, groups: ['Liella!'] }),
    ]) {
      const result = setMemberOrientation(
        protectedGame([target]),
        P1,
        target.instanceId,
        OrientationState.WAITING,
        { kind: 'CARD_EFFECT', playerId: P2, sourceCardId: 'opponent-effect' }
      );
      expect(result).toMatchObject({ changed: true, blockedByWaitingProtection: false });
    }

    const below = member('below-aqours', P1, { blade: 1 });
    let game = protectedGame([]);
    game = registerCards(game, [below]);
    game = updatePlayer(game, P1, (player) => ({
      ...player,
      memberSlots: {
        ...player.memberSlots,
        memberBelow: { ...player.memberSlots.memberBelow, [SlotPosition.LEFT]: [below.instanceId] },
        cardStates: new Map(player.memberSlots.cardStates).set(below.instanceId, {
          orientation: OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        }),
      },
    }));
    expect(
      setMemberOrientation(game, P1, below.instanceId, OrientationState.WAITING, {
        kind: 'CARD_EFFECT',
        playerId: P2,
        sourceCardId: 'opponent-effect',
      })
    ).toBeNull();
  });

  it('distinguishes opponent controller vs actual selection player and leaves candidates unfiltered', () => {
    const target = member('protected-choice', P1, { blade: 2 });
    const game = protectedGame([target]);
    const opponentSelected = setMemberOrientation(
      game,
      P1,
      target.instanceId,
      OrientationState.WAITING,
      {
        kind: 'CARD_EFFECT',
        playerId: P2,
        selectionPlayerId: P2,
        sourceCardId: 'opponent',
      }
    );
    expect(opponentSelected).toMatchObject({ changed: false, blockedByWaitingProtection: true });

    const ownerSelected = setMemberOrientation(
      game,
      P1,
      target.instanceId,
      OrientationState.WAITING,
      {
        kind: 'CARD_EFFECT',
        playerId: P2,
        selectionPlayerId: P1,
        sourceCardId: 'opponent',
      }
    );
    expect(ownerSelected).toMatchObject({ changed: true, blockedByWaitingProtection: false });
    expect(ownerSelected?.gameState.eventLog.at(-1)?.event).toMatchObject({
      cause: { kind: 'CARD_EFFECT', playerId: P2, selectionPlayerId: P1 },
    });

    for (const cause of [
      { kind: 'CARD_EFFECT' as const, playerId: P1, sourceCardId: 'own' },
      { kind: 'RULE_ACTION' as const, playerId: P2 },
      { kind: 'PLAYER_ACTION' as const, playerId: P1 },
    ]) {
      expect(
        setMemberOrientation(game, P1, target.instanceId, OrientationState.WAITING, cause)?.changed
      ).toBe(true);
    }
  });

  it('batch changes distinguish activation prohibition from waiting protection and complete without events for blocked members', () => {
    const protectedTarget = member('protected-batch', P1, { blade: 2 });
    const unprotectedTarget = member('unprotected-batch', P1, { blade: 4 });
    let game = protectedGame([protectedTarget, unprotectedTarget]);
    const result = setMembersOrientation(
      game,
      P1,
      [protectedTarget.instanceId, unprotectedTarget.instanceId],
      OrientationState.WAITING,
      { kind: 'CARD_EFFECT', playerId: P2, sourceCardId: 'batch-opponent' }
    )!;
    expect(result.blockedMemberCardIds).toEqual([]);
    expect(result.blockedByEffectActivationProhibitionMemberCardIds).toEqual([]);
    expect(result.blockedByWaitingProtectionMemberCardIds).toEqual([protectedTarget.instanceId]);
    expect(result.updatedMemberCardIds).toEqual([unprotectedTarget.instanceId]);
    expect(result.gameState.eventLog).toHaveLength(1);
  });

  it('keeps a protected member selectable for an opponent choice, blocks the final wait, and completes continuation', () => {
    const target = member('protected-opponent-choice', P1, { blade: 2 });
    const opponentSource = member('PL!-bp5-013-P', P2, { blade: 2, groups: ["\u03bc's"] });
    let game = protectedGame([target]);
    game = registerCards(game, [opponentSource]);
    game = putStage(game, P2, SlotPosition.CENTER, opponentSource.instanceId);
    game = {
      ...game,
      pendingAbilities: [
        {
          id: 'opponent-select-protected',
          abilityId: PL_BP5_013_ON_ENTER_WAIT_OPPONENT_COST_LTE_FOUR_MEMBER_ABILITY_ID,
          sourceCardId: opponentSource.instanceId,
          controllerId: P2,
          mandatory: true,
          timingId: TriggerCondition.ON_ENTER_STAGE,
          sourceSlot: SlotPosition.CENTER,
        },
      ],
    };
    const selecting = start(game);
    expect(selecting.activeEffect?.selectableCardIds).toContain(target.instanceId);
    const done = confirmActiveEffectStep(
      selecting,
      P2,
      selecting.activeEffect!.id,
      target.instanceId
    );
    expect(done.activeEffect).toBeNull();
    expect(done.pendingAbilities).toEqual([]);
    expect(done.players[0].memberSlots.cardStates.get(target.instanceId)?.orientation).toBe(
      OrientationState.ACTIVE
    );
    expect(done.eventLog).toHaveLength(0);
    expect(done.actionHistory.at(-1)?.payload.targetCardId).toBe(target.instanceId);
  });

  it('uses printed blade despite modifiers, survives source departure, applies to later entrants, and clears at real LIVE_END', () => {
    const target = member('printed-three', P1, { blade: 3 });
    let game = protectedGame([target]);
    game = {
      ...game,
      liveResolution: {
        ...game.liveResolution,
        liveModifiers: [
          {
            kind: 'BLADE',
            target: 'TARGET_MEMBER',
            playerId: P1,
            targetMemberCardId: target.instanceId,
            countDelta: 9,
          },
          {
            kind: 'ORIGINAL_BLADE_REPLACEMENT',
            playerId: P1,
            memberCardId: target.instanceId,
            blade: 8,
            sourceCardId: 'replacement',
            abilityId: 'replacement',
          },
        ],
      },
    };
    game = updatePlayer(game, P1, (player) => ({
      ...player,
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, null),
    }));
    expect(game.memberWaitProtections).toHaveLength(1);
    expect(
      setMemberOrientation(game, P1, target.instanceId, OrientationState.WAITING, {
        kind: 'CARD_EFFECT',
        playerId: P2,
        sourceCardId: 'opponent',
      })?.blockedByWaitingProtection
    ).toBe(true);

    const later = member('later-aqours', P1, { blade: 1 });
    game = registerCards(game, [later]);
    game = putStage(game, P1, SlotPosition.RIGHT, later.instanceId);
    expect(
      setMemberOrientation(game, P1, later.instanceId, OrientationState.WAITING, {
        kind: 'CARD_EFFECT',
        playerId: P2,
        sourceCardId: 'opponent',
      })?.blockedByWaitingProtection
    ).toBe(true);

    const advanced = new GameService().advancePhase({
      ...game,
      turnCount: 1,
      currentPhase: GamePhase.LIVE_RESULT_PHASE,
      currentSubPhase: SubPhase.NONE,
      currentTurnType: TurnType.LIVE_PHASE,
    });
    expect(advanced.success, advanced.error).toBe(true);
    expect(advanced.gameState.memberWaitProtections).toEqual([]);
  });
});

describe('PL!S-bp7-003-SEC choice and position change', () => {
  function setupMove(targetGroups: readonly string[] = ['Aqours']) {
    const source = member('PL!S-bp7-003-SEC');
    const target = member('move-target', P1, { groups: targetGroups });
    const invalid = member('invalid-target', P1, { groups: ['Liella!'] });
    let game = registerCards(createGameState('s003-move', P1, 'P1', P2, 'P2'), [
      source,
      target,
      invalid,
    ]);
    game = putStage(game, P1, SlotPosition.CENTER, source.instanceId);
    game = putStage(game, P1, SlotPosition.LEFT, target.instanceId);
    game = putStage(game, P1, SlotPosition.RIGHT, invalid.instanceId);
    return { game: { ...game, pendingAbilities: [pending(CHOOSE)] }, source, target, invalid };
  }

  it('always offers protection and only offers movement for occupied structured Aqours/Saint Snow areas', () => {
    for (const groups of [['Aqours'], ['Saint Snow'], ['Aqours/SaintSnow']] as const) {
      const waiting = start(setupMove(groups).game);
      expect(waiting.activeEffect).toMatchObject({
        stepText: '请从以下效果中选择1项。',
        selectionLabel: '选择要结算的效果',
        confirmSelectionLabel: '结算所选效果',
        canSkipSelection: false,
      });
      expect(waiting.activeEffect?.selectableOptions?.map((option) => option.id)).toEqual([
        'protect-aqours',
        'position-change',
      ]);
    }
    const sourceOnly = registerCards(createGameState('source-only', P1, 'P1', P2, 'P2'), [
      member('PL!S-bp7-003-SEC'),
    ]);
    const onStage = putStage(sourceOnly, P1, SlotPosition.CENTER, SOURCE_ID);
    const waiting = start({ ...onStage, pendingAbilities: [pending(CHOOSE)] });
    expect(waiting.activeEffect?.selectableOptions?.map((option) => option.id)).toEqual([
      'protect-aqours',
    ]);
  });

  it('establishes protection without requiring the source to remain on stage and audits resolution', () => {
    let waiting = start(setupMove().game);
    waiting = updatePlayer(waiting, P1, (player) => ({
      ...player,
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, null),
    }));
    const done = chooseOption(waiting, 'protect-aqours');
    expect(done.memberWaitProtections).toEqual([
      expect.objectContaining({
        affectedPlayerId: P1,
        sourceCardId: SOURCE_ID,
        abilityId: CHOOSE,
        expiresAt: 'LIVE_END',
      }),
    ]);
    expect(done.actionHistory.at(-1)?.payload.step).toBe('ESTABLISH_WAIT_PROTECTION');
  });

  it('moves to a direct selectable slot, swaps both members, records position movement and emits both standard events', () => {
    const scenario = setupMove();
    const selectingSlot = chooseOption(start(scenario.game), 'position-change');
    expect(selectingSlot.activeEffect?.selectableSlots).toEqual([SlotPosition.LEFT]);
    expect(selectingSlot.activeEffect).toMatchObject({
      selectionLabel: '选择移动后的区域',
      confirmSelectionLabel: '站位变换',
    });
    const done = chooseSlot(selectingSlot, SlotPosition.LEFT);
    expect(done.players[0].memberSlots.slots[SlotPosition.LEFT]).toBe(SOURCE_ID);
    expect(done.players[0].memberSlots.slots[SlotPosition.CENTER]).toBe(scenario.target.instanceId);
    expect(done.players[0].positionMovedThisTurn).toEqual(
      expect.arrayContaining([SOURCE_ID, scenario.target.instanceId])
    );
    const movedEvents = done.eventLog.filter(
      ({ event }) => event.eventType === TriggerCondition.ON_MEMBER_SLOT_MOVED
    );
    expect(movedEvents).toHaveLength(2);
    expect(
      movedEvents.map(({ event }) => ('cardInstanceId' in event ? event.cardInstanceId : null))
    ).toEqual(expect.arrayContaining([SOURCE_ID, scenario.target.instanceId]));
  });

  it('keeps forged option/slot windows, but safely consumes stale source or target after a once-legal choice', () => {
    const waiting = start(setupMove().game);
    expect(chooseOption(waiting, 'forged')).toBe(waiting);
    const selectingSlot = chooseOption(waiting, 'position-change');
    expect(chooseSlot(selectingSlot, SlotPosition.RIGHT)).toBe(selectingSlot);

    const staleTarget = updatePlayer(selectingSlot, P1, (player) => ({
      ...player,
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.LEFT, null),
    }));
    expect(chooseSlot(staleTarget, SlotPosition.LEFT).activeEffect).toBeNull();

    const selectingAgain = chooseOption(start(setupMove().game), 'position-change');
    const sourceLeft = updatePlayer(selectingAgain, P1, (player) => ({
      ...player,
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, null),
    }));
    expect(chooseSlot(sourceLeft, SlotPosition.LEFT).activeEffect).toBeNull();
  });

  it('recomputes by source instance after it moves during the window and repeated confirmation is idempotent', () => {
    const scenario = setupMove();
    let selectingSlot = chooseOption(start(scenario.game), 'position-change');
    selectingSlot = moveMemberBetweenSlots(
      selectingSlot,
      P1,
      SOURCE_ID,
      SlotPosition.RIGHT
    )!.gameState;
    const done = chooseSlot(selectingSlot, SlotPosition.LEFT);
    expect(done.players[0].memberSlots.slots[SlotPosition.LEFT]).toBe(SOURCE_ID);
    const eventCount = done.eventLog.length;
    const repeated = confirmActiveEffectStep(
      done,
      P1,
      selectingSlot.activeEffect!.id,
      undefined,
      SlotPosition.LEFT
    );
    expect(repeated).toBe(done);
    expect(repeated.eventLog).toHaveLength(eventCount);
  });
});

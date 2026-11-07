import { isDeepStrictEqual } from 'node:util';
import { GameCommandType, type GameCommand } from '../../src/application/game-commands';
import {
  GENERIC_DISCARD_LOOK_TOP_ABILITY_ID,
  HS_BP6_001_LIVE_SUCCESS_CHEER_TO_TOP_ABILITY_ID,
  HS_BP6_005_LIVE_SUCCESS_DOLLCHESTRA_MEMBER_REVEALED_CHEER_TO_HAND_ABILITY_ID,
  S_BP6_021_ON_CHEER_SEND_NO_BLADE_AQOURS_MEMBER_ADDITIONAL_CHEER_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import type { GameState } from '../../src/domain/entities/game';
import { LEGACY_GAME_STATE_SCHEMA_VERSION } from '../../src/server/services/replay-constants';
import { TriggerCondition, ZoneType } from '../../src/shared/types/enums';

interface LegacyHistoryComparison {
  readonly isJune2026Fixture: boolean;
  readonly beforeSchemaVersion: string;
  readonly afterSchemaVersion: string;
  readonly decision: {
    readonly decisionType: string;
    readonly abilityId: string | null;
    readonly stepId: string | null;
    readonly sourceCardObjectId: string | null;
  };
  readonly command: GameCommand;
  readonly before: GameState;
  readonly expected: GameState;
}

/**
 * The June V1 fixture predates these history records. Construct their full
 * expected facts from the recorded command and movement, never from replay output.
 * Only this comparison copy changes; normalizing and comparing the entire actual
 * state still checks every added/old record and every unrelated state field.
 */
export function withLegacyReplayHistory(input: LegacyHistoryComparison): GameState {
  const { before, expected, command, decision } = input;
  if (
    !input.isJune2026Fixture ||
    input.beforeSchemaVersion !== LEGACY_GAME_STATE_SCHEMA_VERSION ||
    input.afterSchemaVersion !== LEGACY_GAME_STATE_SCHEMA_VERSION
  )
    return expected;

  const cheerHistory = withLegacyRevealedCheerMovement(input);
  if (cheerHistory !== expected) return cheerHistory;

  const player = before.players.find((candidate) => candidate.id === command.playerId);
  const afterPlayer = expected.players.find((candidate) => candidate.id === command.playerId);
  const oldActions = before.actionHistory.length;
  const resolve = expected.actionHistory[oldActions];
  if (
    !player ||
    !afterPlayer ||
    expected.actionHistory.length !== oldActions + 1 ||
    !isDeepStrictEqual(expected.actionHistory.slice(0, oldActions), before.actionHistory) ||
    expected.actionSequence !== before.actionSequence + 1 ||
    resolve?.sequence !== expected.actionSequence ||
    resolve.playerId !== command.playerId
  )
    return expected;

  if (
    command.type === GameCommandType.SELECT_SUCCESS_LIVE &&
    decision.decisionType === 'SELECT_SUCCESS_LIVE_SUBMITTED'
  ) {
    const { cardId } = command;
    if (
      before.cardRegistry.get(cardId)?.ownerId !== command.playerId ||
      player.liveZone.cardIds.filter((id) => id === cardId).length !== 1 ||
      player.successZone.cardIds.includes(cardId) ||
      !isDeepStrictEqual(
        afterPlayer.liveZone.cardIds,
        player.liveZone.cardIds.filter((id) => id !== cardId)
      ) ||
      !isDeepStrictEqual(afterPlayer.successZone.cardIds, [
        ...player.successZone.cardIds,
        cardId,
      ]) ||
      expected.eventSequence !== before.eventSequence ||
      !isDeepStrictEqual(expected.eventLog, before.eventLog) ||
      resolve.type !== 'MOVE_CARD' ||
      !isDeepStrictEqual(resolve.payload, {
        cardId,
        fromZone: ZoneType.LIVE_ZONE,
        toZone: ZoneType.SUCCESS_ZONE,
        action: 'SELECT_SUCCESS_CARD',
      })
    )
      return expected;
    return {
      ...expected,
      eventSequence: before.eventSequence + 1,
      eventLog: [
        ...expected.eventLog,
        {
          sequence: before.eventSequence + 1,
          event: {
            eventId: 'legacy-comparison:success-entry',
            timestamp: 0,
            eventType: TriggerCondition.ON_ENTER_SUCCESS_ZONE,
            cardInstanceId: cardId,
            fromZone: ZoneType.LIVE_ZONE,
            toZone: ZoneType.SUCCESS_ZONE,
            ownerId: command.playerId,
            controllerId: command.playerId,
            triggerPlayerId: command.playerId,
            successZoneCardCountAfter: afterPlayer.successZone.cardIds.length,
          },
        },
      ],
    };
  }

  const effect = before.activeEffect;
  if (
    command.type !== GameCommandType.CONFIRM_EFFECT_STEP ||
    decision.decisionType !== 'ACTIVE_EFFECT_SUBMITTED' ||
    decision.abilityId !== GENERIC_DISCARD_LOOK_TOP_ABILITY_ID ||
    decision.stepId !== 'DISCARD_LOOK_SELECT_DISCARD' ||
    effect?.abilityId !== decision.abilityId ||
    effect.stepId !== decision.stepId ||
    effect.id !== command.effectId ||
    effect.controllerId !== command.playerId ||
    effect.awaitingPlayerId !== command.playerId ||
    effect.sourceCardId !== decision.sourceCardObjectId ||
    !command.selectedCardId
  )
    return expected;

  const cardId = command.selectedCardId;
  const nextEffect = expected.activeEffect;
  const newEvent = expected.eventLog[before.eventLog.length];
  const { eventId: _eventId, timestamp: _timestamp, ...discardFacts } = newEvent?.event ?? {};
  if (
    before.cardRegistry.get(cardId)?.ownerId !== command.playerId ||
    before.cardRegistry.get(effect.sourceCardId)?.ownerId !== command.playerId ||
    !Object.values(player.memberSlots.slots).includes(effect.sourceCardId) ||
    !effect.selectableCardIds?.includes(cardId) ||
    player.hand.cardIds.filter((id) => id === cardId).length !== 1 ||
    player.waitingRoom.cardIds.includes(cardId) ||
    !isDeepStrictEqual(
      afterPlayer.hand.cardIds,
      player.hand.cardIds.filter((id) => id !== cardId)
    ) ||
    !isDeepStrictEqual(afterPlayer.waitingRoom.cardIds, [...player.waitingRoom.cardIds, cardId]) ||
    before.inspectionZone.cardIds.length !== 0 ||
    !isDeepStrictEqual(
      expected.inspectionZone.cardIds,
      player.mainDeck.cardIds.slice(0, expected.inspectionZone.cardIds.length)
    ) ||
    !isDeepStrictEqual(
      afterPlayer.mainDeck.cardIds,
      player.mainDeck.cardIds.slice(expected.inspectionZone.cardIds.length)
    ) ||
    nextEffect?.abilityId !== effect.abilityId ||
    nextEffect.sourceCardId !== effect.sourceCardId ||
    nextEffect.controllerId !== command.playerId ||
    nextEffect.stepId !== 'DISCARD_LOOK_SELECT_TAKE' ||
    expected.eventLog.length !== before.eventLog.length + 1 ||
    !isDeepStrictEqual(expected.eventLog.slice(0, before.eventLog.length), before.eventLog) ||
    expected.eventSequence !== before.eventSequence + 1 ||
    newEvent?.sequence !== expected.eventSequence ||
    !isDeepStrictEqual(discardFacts, {
      eventType: TriggerCondition.ON_ENTER_WAITING_ROOM,
      cardInstanceId: cardId,
      cardInstanceIds: [cardId],
      fromZone: ZoneType.HAND,
      toZone: ZoneType.WAITING_ROOM,
      ownerId: command.playerId,
      controllerId: command.playerId,
      triggerPlayerId: command.playerId,
    }) ||
    resolve.type !== 'RESOLVE_ABILITY' ||
    !isDeepStrictEqual(resolve.payload, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'START_INSPECTION',
      discardCardId: cardId,
      inspectedCardIds: expected.inspectionZone.cardIds,
      selectableCardIds: nextEffect.selectableCardIds,
    })
  )
    return expected;

  return {
    ...expected,
    actionSequence: expected.actionSequence + 1,
    actionHistory: [
      ...before.actionHistory,
      {
        id: 'legacy-comparison:discard-cost',
        timestamp: 0,
        sequence: before.actionSequence + 1,
        type: 'PAY_COST',
        playerId: command.playerId,
        payload: {
          abilityId: effect.abilityId,
          sourceCardId: effect.sourceCardId,
          discardedHandCardIds: [cardId],
        },
      },
      { ...resolve, sequence: resolve.sequence + 1 },
    ],
  };
}

const CHEER_MOVEMENT_EVENT_ID = 'legacy-comparison:revealed-cheer-movement';
const CHEER_MOVEMENT_DISPATCH_ID = 'legacy-comparison:dispatch-cheer-movement';
const CHEER_MOVEMENT_TIMING = TriggerCondition.ON_REVEALED_CHEER_CARDS_MOVED;
const LEGACY_CHEER_MOVEMENTS = [
  [
    HS_BP6_005_LIVE_SUCCESS_DOLLCHESTRA_MEMBER_REVEALED_CHEER_TO_HAND_ABILITY_ID,
    'HS_BP6_005_SELECT_REVEALED_CHEER_DOLLCHESTRA_MEMBER_TO_HAND',
    'HAND',
    ZoneType.HAND,
  ],
  [
    HS_BP6_001_LIVE_SUCCESS_CHEER_TO_TOP_ABILITY_ID,
    'HS_BP6_001_SELECT_REVEALED_CHEER_TO_TOP',
    'MAIN_DECK_TOP',
    ZoneType.MAIN_DECK,
  ],
  [
    S_BP6_021_ON_CHEER_SEND_NO_BLADE_AQOURS_MEMBER_ADDITIONAL_CHEER_ABILITY_ID,
    'S_BP6_021_SELECT_REVEALED_CHEER_TO_WAITING_ROOM',
    'WAITING_ROOM',
    ZoneType.WAITING_ROOM,
  ],
] as const;

/** Independently add the missing pair before the recorded follow-up effects. */
function withLegacyRevealedCheerMovement(input: LegacyHistoryComparison): GameState {
  const { before, expected, command, decision } = input;
  const effect = before.activeEffect;
  const config = LEGACY_CHEER_MOVEMENTS.find(
    ([ability, step]) => ability === decision.abilityId && step === decision.stepId
  );
  if (
    !config ||
    command.type !== GameCommandType.CONFIRM_EFFECT_STEP ||
    decision.decisionType !== 'ACTIVE_EFFECT_SUBMITTED' ||
    !effect ||
    effect.id !== command.effectId ||
    effect.abilityId !== config[0] ||
    effect.stepId !== config[1] ||
    effect.controllerId !== command.playerId ||
    effect.awaitingPlayerId !== command.playerId ||
    effect.sourceCardId !== decision.sourceCardObjectId ||
    effect.metadata?.cheerRevealedCardSelection !== true ||
    effect.metadata.destination !== config[2] ||
    expected.activeEffect !== null
  )
    return expected;
  const ids = command.selectedCardIds ?? (command.selectedCardId ? [command.selectedCardId] : []);
  const cardId = ids[0];
  const player = before.players.find((candidate) => candidate.id === command.playerId);
  const after = expected.players.find((candidate) => candidate.id === command.playerId);
  const firstPlayer = before.players[before.firstPlayerIndex];
  const cheerKey =
    firstPlayer?.id === command.playerId ? 'firstPlayerCheerCardIds' : 'secondPlayerCheerCardIds';
  if (
    ids.length !== 1 ||
    !cardId ||
    !player ||
    !after ||
    (command.selectedCardId && command.selectedCardIds !== undefined) ||
    !effect.selectableCardIds?.includes(cardId) ||
    before.cardRegistry.get(cardId)?.ownerId !== command.playerId ||
    before.cardRegistry.get(effect.sourceCardId)?.ownerId !== command.playerId ||
    !before.liveResolution[cheerKey].includes(cardId) ||
    before.resolutionZone.cardIds.filter((id) => id === cardId).length !== 1 ||
    !before.resolutionZone.revealedCardIds.includes(cardId) ||
    [player.hand, player.waitingRoom, player.mainDeck].some((zone) =>
      zone.cardIds.includes(cardId)
    ) ||
    !isDeepStrictEqual(
      expected.actionHistory.slice(0, before.actionHistory.length),
      before.actionHistory
    ) ||
    !isDeepStrictEqual(expected.eventLog.slice(0, before.eventLog.length), before.eventLog)
  )
    return expected;

  const actions = expected.actionHistory.slice(before.actionHistory.length);
  const events = expected.eventLog.slice(before.eventLog.length);
  const resolve = actions.at(-1);
  const extra = resolve?.payload.additionalCheerCardIds;
  const count = resolve?.payload.additionalCheerCount;
  const additional = config[2] === 'WAITING_ROOM';
  if (
    !resolve ||
    !Array.isArray(extra) ||
    !extra.every((id) => typeof id === 'string') ||
    typeof count !== 'number' ||
    !Number.isInteger(count) ||
    count < 0 ||
    count > 4 ||
    (!additional && (count !== 0 || extra.length !== 0)) ||
    (additional && (count === 0 || extra.length !== count)) ||
    actions.length !== (additional ? 3 : 1) ||
    events.length !== (additional ? 1 : 0) ||
    expected.actionSequence !== before.actionSequence + actions.length ||
    expected.eventSequence !== before.eventSequence + events.length ||
    actions.some((action, index) => action.sequence !== before.actionSequence + index + 1) ||
    events.some((entry, index) => entry.sequence !== before.eventSequence + index + 1) ||
    resolve.type !== 'RESOLVE_ABILITY' ||
    resolve.playerId !== player.id ||
    !isDeepStrictEqual(resolve.payload, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'MOVE_REVEALED_CHEER_CARD',
      movedCardIds: [cardId],
      additionalCheerCardIds: extra,
      additionalCheerCount: count,
      destination: config[2],
    })
  )
    return expected;
  if (additional) {
    const use = actions[0];
    const cheer = actions[1];
    const event = events[0]?.event;
    if (
      use.type !== 'RESOLVE_ABILITY' ||
      use.playerId !== player.id ||
      !isDeepStrictEqual(use.payload, {
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: 'ABILITY_USE',
        turnCount: before.turnCount,
      }) ||
      cheer.type !== 'CHEER' ||
      cheer.playerId !== player.id ||
      !isDeepStrictEqual(cheer.payload, {
        additional: true,
        automated: true,
        cheerCardIds: extra,
        cheerCount: count,
      }) ||
      event?.eventType !== TriggerCondition.ON_CHEER ||
      !('playerId' in event) ||
      event.playerId !== player.id ||
      event.triggerPlayerId !== player.id ||
      event.additional !== true ||
      event.automated !== true ||
      event.totalBlade !== count ||
      !isDeepStrictEqual(event.revealedCardIds, extra) ||
      (events[0].causedByActionId !== undefined && events[0].causedByActionId !== cheer.id)
    )
      return expected;
  }
  const removed = (values: readonly string[]) => values.filter((id) => id !== cardId);
  if (
    !isDeepStrictEqual(
      after.hand.cardIds,
      config[2] === 'HAND' ? [...player.hand.cardIds, cardId] : player.hand.cardIds
    ) ||
    !isDeepStrictEqual(
      after.waitingRoom.cardIds,
      additional ? [...player.waitingRoom.cardIds, cardId] : player.waitingRoom.cardIds
    ) ||
    !isDeepStrictEqual(extra, additional ? player.mainDeck.cardIds.slice(0, count) : []) ||
    !isDeepStrictEqual(
      after.mainDeck.cardIds,
      config[2] === 'MAIN_DECK_TOP'
        ? [cardId, ...player.mainDeck.cardIds]
        : additional
          ? player.mainDeck.cardIds.slice(count)
          : player.mainDeck.cardIds
    ) ||
    !isDeepStrictEqual(expected.resolutionZone.cardIds, [
      ...removed(before.resolutionZone.cardIds),
      ...extra,
    ]) ||
    !isDeepStrictEqual(expected.resolutionZone.revealedCardIds, [
      ...removed(before.resolutionZone.revealedCardIds),
      ...extra,
    ]) ||
    !isDeepStrictEqual(expected.liveResolution[cheerKey], [
      ...before.liveResolution[cheerKey],
      ...extra,
    ])
  )
    return expected;

  const shiftedActions = actions.map((action) => ({
    ...action,
    sequence: action.sequence + 1,
    id: `${expected.gameId}-${action.sequence + 1}`,
  }));
  const actionIds = new Map(actions.map((action, index) => [action.id, shiftedActions[index].id]));
  return {
    ...expected,
    actionSequence: expected.actionSequence + 1,
    actionHistory: [
      ...before.actionHistory,
      {
        id: CHEER_MOVEMENT_DISPATCH_ID,
        timestamp: 0,
        sequence: before.actionSequence + 1,
        type: 'DISPATCH_TRIGGER_EVENT',
        playerId: player.id,
        payload: { eventId: CHEER_MOVEMENT_EVENT_ID, triggerCondition: CHEER_MOVEMENT_TIMING },
      },
      ...shiftedActions,
    ],
    eventSequence: expected.eventSequence + 1,
    eventLog: [
      ...before.eventLog,
      {
        sequence: before.eventSequence + 1,
        event: {
          eventId: CHEER_MOVEMENT_EVENT_ID,
          timestamp: 0,
          eventType: CHEER_MOVEMENT_TIMING,
          playerId: player.id,
          controllerId: player.id,
          triggerPlayerId: player.id,
          movedCardIds: [cardId],
          fromZone: ZoneType.RESOLUTION_ZONE,
          toZone: config[3],
          destination: config[2],
          cause: {
            kind: 'CARD_EFFECT',
            playerId: player.id,
            sourceCardId: effect.sourceCardId,
            abilityId: effect.abilityId,
            pendingAbilityId: effect.id,
          },
        },
      },
      ...events.map((entry) => ({
        ...entry,
        sequence: entry.sequence + 1,
        ...(entry.causedByActionId
          ? { causedByActionId: actionIds.get(entry.causedByActionId) ?? entry.causedByActionId }
          : {}),
      })),
    ],
  };
}

/** The harness drops volatile IDs; validate this added pair's raw links before doing so. */
export function getLegacyReplayHistoryLinkIssues(expected: GameState, actual: GameState): string[] {
  const marker = expected.eventLog.find((entry) => entry.event.eventId === CHEER_MOVEMENT_EVENT_ID);
  if (!marker) return [];
  const issues: string[] = [];
  const wanted = marker.event;
  const entry = actual.eventLog.find((candidate) => candidate.sequence === marker.sequence);
  const event = entry?.event;
  const dispatch = expected.actionHistory.find(
    (action) => action.id === CHEER_MOVEMENT_DISPATCH_ID
  );
  if (
    wanted.eventType !== CHEER_MOVEMENT_TIMING ||
    event?.eventType !== CHEER_MOVEMENT_TIMING ||
    !dispatch
  ) {
    return ['missing revealed-cheer movement event/dispatch pair'];
  }
  const { eventId: ignoredExpectedId, timestamp: ignoredExpectedTime, ...expectedFacts } = wanted;
  const { eventId: ignoredActualId, timestamp: ignoredActualTime, ...actualFacts } = event;
  if (!isDeepStrictEqual(actualFacts, expectedFacts))
    issues.push('revealed-cheer movement facts/cause mismatch');
  if (
    !event.eventId ||
    actual.eventLog.filter((candidate) => candidate.event.eventId === event.eventId).length !== 1
  )
    issues.push('revealed-cheer movement event ID is missing or duplicated');
  const linked = actual.actionHistory.filter(
    (action) => action.type === 'DISPATCH_TRIGGER_EVENT' && action.payload.eventId === event.eventId
  );
  if (
    linked.length !== 1 ||
    linked[0].sequence !== dispatch.sequence ||
    linked[0].playerId !== dispatch.playerId ||
    !isDeepStrictEqual(linked[0].payload, {
      eventId: event.eventId,
      triggerCondition: CHEER_MOVEMENT_TIMING,
    })
  )
    issues.push('revealed-cheer movement dispatch link mismatch');
  return issues;
}

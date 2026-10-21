import { isDeepStrictEqual } from 'node:util';
import { GameCommandType, type GameCommand } from '../../src/application/game-commands';
import { GENERIC_DISCARD_LOOK_TOP_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
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
 * The June V1 fixture predates these two history records. Construct their full
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

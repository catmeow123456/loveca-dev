import { describe, expect, it } from 'vitest';
import { GameCommandType, type GameCommand } from '../../src/application/game-commands';
import { GENERIC_DISCARD_LOOK_TOP_ABILITY_ID as ABILITY } from '../../src/application/card-effects/ability-ids';
import {
  createCardInstance,
  createHeartRequirement,
  type LiveCardData,
  type MemberCardData,
} from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import {
  GAME_STATE_SCHEMA_VERSION,
  LEGACY_GAME_STATE_SCHEMA_VERSION,
} from '../../src/server/services/replay-constants';
import { CardType, SlotPosition, TriggerCondition, ZoneType } from '../../src/shared/types/enums';
import { withLegacyReplayHistory } from '../helpers/legacy-replay-history';

type Comparison = Parameters<typeof withLegacyReplayHistory>[0];

function sample(kind: 'success' | 'cost'): { input: Comparison; actual: GameState } {
  const sourceData: MemberCardData = {
    cardCode: 'source',
    name: 'source',
    cardType: CardType.MEMBER,
    cost: 1,
    blade: 1,
    hearts: [],
  };
  const liveCards = ['selected', 'old-success', 'top', 'rest'].map((id) => {
    const data: LiveCardData = {
      cardCode: id,
      name: id,
      cardType: CardType.LIVE,
      score: 1,
      requirements: createHeartRequirement({}),
    };
    return createCardInstance(data, 'p1', id);
  });
  let before = registerCards(createGameState('legacy', 'p1', 'P1', 'p2', 'P2'), [
    createCardInstance(sourceData, 'p1', 'source'),
    ...liveCards,
  ]);
  before = updatePlayer(before, 'p1', (player) => ({
    ...player,
    liveZone: { ...player.liveZone, cardIds: kind === 'success' ? ['selected'] : [] },
    successZone: { ...player.successZone, cardIds: ['old-success'] },
    hand: { ...player.hand, cardIds: kind === 'cost' ? ['selected'] : [] },
    mainDeck: { ...player.mainDeck, cardIds: ['top', 'rest'] },
    memberSlots: {
      ...player.memberSlots,
      slots: { ...player.memberSlots.slots, [SlotPosition.LEFT]: 'source' },
    },
  }));
  before = {
    ...before,
    eventSequence: 4,
    eventLog: [
      {
        sequence: 4,
        event: {
          eventId: 'old-event',
          timestamp: 123,
          eventType: TriggerCondition.ON_GAME_START,
          firstPlayerId: 'p1',
          secondPlayerId: 'p2',
        },
      },
    ],
    actionSequence: 7,
    actionHistory: [
      {
        id: 'old-action',
        timestamp: 123,
        sequence: 7,
        type: 'PHASE_CHANGE',
        playerId: 'p1',
        payload: { old: true },
      },
    ],
    activeEffect:
      kind === 'cost'
        ? {
            id: 'effect',
            abilityId: ABILITY,
            sourceCardId: 'source',
            controllerId: 'p1',
            awaitingPlayerId: 'p1',
            effectText: 'discard and inspect',
            stepText: 'discard',
            stepId: 'DISCARD_LOOK_SELECT_DISCARD',
            selectableCardIds: ['selected'],
          }
        : null,
  };
  let expected = updatePlayer(before, 'p1', (player) =>
    kind === 'success'
      ? {
          ...player,
          liveZone: { ...player.liveZone, cardIds: [] },
          successZone: { ...player.successZone, cardIds: ['old-success', 'selected'] },
        }
      : {
          ...player,
          hand: { ...player.hand, cardIds: [] },
          waitingRoom: { ...player.waitingRoom, cardIds: ['selected'] },
          mainDeck: { ...player.mainDeck, cardIds: ['rest'] },
        }
  );
  expected = {
    ...expected,
    actionSequence: 8,
    actionHistory: [
      ...before.actionHistory,
      {
        id: 'resolve',
        timestamp: 321,
        sequence: 8,
        playerId: 'p1',
        type: kind === 'success' ? 'MOVE_CARD' : 'RESOLVE_ABILITY',
        payload:
          kind === 'success'
            ? {
                cardId: 'selected',
                fromZone: ZoneType.LIVE_ZONE,
                toZone: ZoneType.SUCCESS_ZONE,
                action: 'SELECT_SUCCESS_CARD',
              }
            : {
                pendingAbilityId: 'effect',
                abilityId: ABILITY,
                sourceCardId: 'source',
                step: 'START_INSPECTION',
                discardCardId: 'selected',
                inspectedCardIds: ['top'],
                selectableCardIds: ['top'],
              },
      },
    ],
  };
  if (kind === 'cost')
    expected = {
      ...expected,
      eventSequence: 5,
      eventLog: [
        ...before.eventLog,
        {
          sequence: 5,
          event: {
            eventId: 'discard',
            timestamp: 321,
            eventType: TriggerCondition.ON_ENTER_WAITING_ROOM,
            cardInstanceId: 'selected',
            cardInstanceIds: ['selected'],
            fromZone: ZoneType.HAND,
            toZone: ZoneType.WAITING_ROOM,
            ownerId: 'p1',
            controllerId: 'p1',
            triggerPlayerId: 'p1',
          },
        },
      ],
      inspectionZone: { ...expected.inspectionZone, cardIds: ['top'] },
      activeEffect: {
        ...before.activeEffect!,
        stepId: 'DISCARD_LOOK_SELECT_TAKE',
        selectableCardIds: ['top'],
      },
    };
  // Independent expected runtime records; do not use the alignment helper to build actual.
  const actual: GameState =
    kind === 'success'
      ? {
          ...expected,
          eventSequence: 5,
          eventLog: [
            ...expected.eventLog,
            {
              sequence: 5,
              event: {
                eventId: 'new-event',
                timestamp: 999,
                eventType: TriggerCondition.ON_ENTER_SUCCESS_ZONE,
                cardInstanceId: 'selected',
                fromZone: ZoneType.LIVE_ZONE,
                toZone: ZoneType.SUCCESS_ZONE,
                ownerId: 'p1',
                controllerId: 'p1',
                triggerPlayerId: 'p1',
                successZoneCardCountAfter: 2,
              },
            },
          ],
        }
      : {
          ...expected,
          actionSequence: 9,
          actionHistory: [
            ...before.actionHistory,
            {
              id: 'new-cost',
              timestamp: 999,
              sequence: 8,
              type: 'PAY_COST',
              playerId: 'p1',
              payload: {
                abilityId: ABILITY,
                sourceCardId: 'source',
                discardedHandCardIds: ['selected'],
              },
            },
            { ...expected.actionHistory[1]!, sequence: 9 },
          ],
        };
  const command: GameCommand =
    kind === 'success'
      ? {
          type: GameCommandType.SELECT_SUCCESS_LIVE,
          playerId: 'p1',
          cardId: 'selected',
          timestamp: 0,
        }
      : {
          type: GameCommandType.CONFIRM_EFFECT_STEP,
          playerId: 'p1',
          effectId: 'effect',
          selectedCardId: 'selected',
          timestamp: 0,
        };
  return {
    actual,
    input: {
      isJune2026Fixture: true,
      beforeSchemaVersion: LEGACY_GAME_STATE_SCHEMA_VERSION,
      afterSchemaVersion: LEGACY_GAME_STATE_SCHEMA_VERSION,
      before,
      expected,
      command,
      decision: {
        decisionType:
          kind === 'success' ? 'SELECT_SUCCESS_LIVE_SUBMITTED' : 'ACTIVE_EFFECT_SUBMITTED',
        abilityId: kind === 'cost' ? ABILITY : null,
        stepId: kind === 'cost' ? 'DISCARD_LOOK_SELECT_DISCARD' : null,
        sourceCardObjectId: kind === 'cost' ? 'source' : null,
      },
    },
  };
}

// Same volatile fields removed by the harness, while retaining the complete state.
function comparable(state: GameState) {
  return {
    ...state,
    eventLog: state.eventLog.map(({ event, ...entry }) => {
      const { eventId: _id, timestamp: _timestamp, ...facts } = event;
      return { ...entry, event: facts };
    }),
    actionHistory: state.actionHistory.map(
      ({ id: _id, timestamp: _timestamp, ...action }) => action
    ),
  };
}

describe('June V1 replay history comparison', () => {
  it.each(['success', 'cost'] as const)(
    'adds only the independently expected %s record without mutation',
    (kind) => {
      const { input, actual } = sample(kind);
      const snapshot = structuredClone(input);
      const aligned = withLegacyReplayHistory(input);
      expect(comparable(aligned)).toEqual(comparable(actual));
      expect(input).toEqual(snapshot);
      expect(withLegacyReplayHistory({ ...input, expected: aligned })).toBe(aligned);
      expect(comparable(aligned)).not.toEqual(comparable(input.expected)); // Missing new record must fail.
    }
  );

  it.each([
    ['event type', { eventType: TriggerCondition.ON_ENTER_HAND }],
    ['selected card', { cardInstanceId: 'other' }],
    ['owner', { ownerId: 'p2' }],
    ['controller', { controllerId: 'p2' }],
    ['trigger player', { triggerPlayerId: 'p2' }],
    ['source zone', { fromZone: ZoneType.HAND }],
    ['destination zone', { toZone: ZoneType.HAND }],
    ['post-entry count', { successZoneCardCountAfter: 1 }],
    ['extra payload', { cause: { kind: 'CARD_EFFECT', abilityId: 'other' } }],
  ])('rejects an incorrect success event %s', (_label, patch) => {
    const { input, actual } = sample('success');
    const wrong = {
      ...actual,
      eventLog: actual.eventLog.map((entry, index) =>
        index === 1 ? { ...entry, event: { ...entry.event, ...patch } } : entry
      ),
    } as GameState;
    expect(comparable(withLegacyReplayHistory(input))).not.toEqual(comparable(wrong));
  });

  it.each([
    ['cost card', { discardedHandCardIds: ['other'] }],
    ['ability', { abilityId: 'other' }],
    ['source card', { sourceCardId: 'other' }],
    ['extra cost', { paidEnergyCardIds: ['other'] }],
  ])('rejects an incorrect PAY_COST %s', (_label, patch) => {
    const { input, actual } = sample('cost');
    const wrong = {
      ...actual,
      actionHistory: actual.actionHistory.map((action, index) =>
        index === 1 ? { ...action, payload: { ...action.payload, ...patch } } : action
      ),
    };
    expect(comparable(withLegacyReplayHistory(input))).not.toEqual(comparable(wrong));
  });

  it.each(['success', 'cost'] as const)(
    'retains all old records, ordering and other state checks for %s',
    (kind) => {
      const { input, actual } = sample(kind);
      const baseline = comparable(withLegacyReplayHistory(input));
      const wrongStates: GameState[] = [
        { ...actual, eventLog: [...actual.eventLog, actual.eventLog[1]!] },
        { ...actual, actionHistory: [...actual.actionHistory, actual.actionHistory[1]!] },
        { ...actual, eventSequence: actual.eventSequence + 1 },
        { ...actual, actionSequence: actual.actionSequence + 1 },
        {
          ...actual,
          eventLog: actual.eventLog.map((entry, index) => ({
            ...entry,
            sequence: index === 1 ? 100 : entry.sequence,
          })),
        },
        {
          ...actual,
          eventLog: actual.eventLog.map((entry, index) =>
            index === 0 ? { ...entry, event: { ...entry.event, triggerPlayerId: 'p2' } } : entry
          ),
        },
        {
          ...actual,
          actionHistory: actual.actionHistory.map((action, index) =>
            index === 0 ? { ...action, payload: { old: false } } : action
          ),
        },
        {
          ...actual,
          actionHistory: actual.actionHistory.map((action, index) =>
            index === 1 ? { ...action, playerId: 'p2' } : action
          ),
        },
        {
          ...actual,
          actionHistory: actual.actionHistory.map((action, index) =>
            index === 1 ? { ...action, type: 'RULE_ACTION' } : action
          ),
        },
        {
          ...actual,
          actionHistory: actual.actionHistory.map((action, index) =>
            index === 1 ? { ...action, sequence: 100 } : action
          ),
        },
        { ...actual, actionHistory: [...actual.actionHistory].reverse() },
        { ...actual, turnCount: actual.turnCount + 1 },
        updatePlayer(actual, 'p1', (player) => ({
          ...player,
          hand: { ...player.hand, cardIds: ['drift'] },
        })),
      ];
      for (const [index, wrong] of wrongStates.entries())
        expect(baseline, `drift ${index}`).not.toEqual(comparable(wrong));
    }
  );

  it.each(['success', 'cost'] as const)(
    'leaves new formats and unproven historical %s movement untouched',
    (kind) => {
      const { input, actual } = sample(kind);
      const cases: Comparison[] = [
        { ...input, isJune2026Fixture: false },
        { ...input, beforeSchemaVersion: GAME_STATE_SCHEMA_VERSION },
        { ...input, afterSchemaVersion: GAME_STATE_SCHEMA_VERSION },
        { ...input, decision: { ...input.decision, decisionType: 'OTHER_SUBMITTED' } },
        {
          ...input,
          expected: updatePlayer(input.expected, 'p1', (player) => ({
            ...player,
            liveZone: { ...player.liveZone, cardIds: ['selected'] },
            hand: { ...player.hand, cardIds: ['selected'] },
          })),
        },
        {
          ...input,
          before: {
            ...input.before,
            cardRegistry: new Map(input.before.cardRegistry).set('selected', {
              ...input.before.cardRegistry.get('selected')!,
              ownerId: 'p2',
            }),
          },
        },
        {
          ...input,
          expected: {
            ...input.expected,
            actionHistory: input.expected.actionHistory.map((action, index) =>
              index === 0 ? { ...action, payload: { old: false } } : action
            ),
          },
        },
        { ...input, expected: actual },
      ];
      if (kind === 'cost')
        cases.push(
          { ...input, decision: { ...input.decision, abilityId: 'other' } },
          { ...input, decision: { ...input.decision, stepId: 'DISCARD_LOOK_SELECT_TAKE' } },
          { ...input, decision: { ...input.decision, sourceCardObjectId: 'other' } },
          {
            ...input,
            expected: {
              ...input.expected,
              eventLog: input.expected.eventLog.map((entry, index) =>
                index === 1
                  ? { ...entry, event: { ...entry.event, fromZone: ZoneType.MAIN_DECK } }
                  : entry
              ),
            } as GameState,
          }
        );
      for (const candidate of cases)
        expect(withLegacyReplayHistory(candidate)).toBe(candidate.expected);
      for (const candidate of cases.slice(0, 3)) {
        expect(comparable(withLegacyReplayHistory(candidate))).not.toEqual(comparable(actual));
      }
    }
  );
});

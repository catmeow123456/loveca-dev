import { describe, expect, it } from 'vitest';
import {
  HS_BP6_001_LIVE_SUCCESS_CHEER_TO_TOP_ABILITY_ID as TOP,
  HS_BP6_005_LIVE_SUCCESS_DOLLCHESTRA_MEMBER_REVEALED_CHEER_TO_HAND_ABILITY_ID as HAND,
  S_BP6_021_ON_CHEER_SEND_NO_BLADE_AQOURS_MEMBER_ADDITIONAL_CHEER_ABILITY_ID as WAITING,
} from '../../src/application/card-effects/ability-ids';
import { GameCommandType } from '../../src/application/game-commands';
import { createCardInstance, type MemberCardData } from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type GameAction,
  type GameState,
} from '../../src/domain/entities/game';
import {
  GAME_STATE_SCHEMA_VERSION,
  LEGACY_GAME_STATE_SCHEMA_VERSION,
} from '../../src/server/services/replay-constants';
import { CardType, TriggerCondition as T, ZoneType as Z } from '../../src/shared/types/enums';
import {
  getLegacyReplayHistoryLinkIssues,
  withLegacyReplayHistory,
} from '../helpers/legacy-replay-history';

type Comparison = Parameters<typeof withLegacyReplayHistory>[0];
type Destination = 'HAND' | 'MAIN_DECK_TOP' | 'WAITING_ROOM';
const cases = [
  ['HAND', HAND, 'HS_BP6_005_SELECT_REVEALED_CHEER_DOLLCHESTRA_MEMBER_TO_HAND', Z.HAND],
  ['MAIN_DECK_TOP', TOP, 'HS_BP6_001_SELECT_REVEALED_CHEER_TO_TOP', Z.MAIN_DECK],
  ['WAITING_ROOM', WAITING, 'S_BP6_021_SELECT_REVEALED_CHEER_TO_WAITING_ROOM', Z.WAITING_ROOM],
] as const;

function sample(destination: Destination): { input: Comparison; actual: GameState } {
  const [, abilityId, stepId, toZone] = cases.find(([value]) => value === destination)!;
  const cards = ['source', 'selected', 'top', 'rest'].map((id) => {
    const data: MemberCardData = {
      cardType: CardType.MEMBER,
      cardCode: id,
      name: id,
      cost: 5,
      blade: 1,
      hearts: [],
    };
    return createCardInstance(data, 'p1', id);
  });
  const additional = destination === 'WAITING_ROOM';
  let before = registerCards(createGameState('legacy', 'p1', 'P1', 'p2', 'P2'), cards);
  before = updatePlayer(before, 'p1', (player) => ({
    ...player,
    mainDeck: { ...player.mainDeck, cardIds: ['top', 'rest'] },
  }));
  before = {
    ...before,
    resolutionZone: {
      ...before.resolutionZone,
      cardIds: ['selected'],
      revealedCardIds: ['selected'],
    },
    liveResolution: { ...before.liveResolution, firstPlayerCheerCardIds: ['selected'] },
    activeEffect: {
      id: 'effect',
      abilityId,
      stepId,
      sourceCardId: 'source',
      controllerId: 'p1',
      awaitingPlayerId: 'p1',
      effectText: 'recorded effect',
      stepText: 'recorded selection',
      selectableCardIds: ['selected'],
      metadata: { cheerRevealedCardSelection: true, destination },
    },
    actionSequence: 7,
    actionHistory: [
      {
        id: 'old-action',
        type: 'PHASE_CHANGE',
        playerId: 'p1',
        sequence: 7,
        timestamp: 10,
        payload: { old: true },
      },
    ],
    eventSequence: 4,
    eventLog: [
      {
        sequence: 4,
        event: {
          eventId: 'old-cheer',
          eventType: T.ON_CHEER,
          playerId: 'p1',
          triggerPlayerId: 'p1',
          totalBlade: 1,
          revealedCardIds: ['selected'],
          automated: true,
          additional: false,
          timestamp: 10,
        },
      },
    ],
  };
  const extra = additional ? ['top'] : [];
  const resolve: GameAction = {
    id: additional ? 'legacy-10' : 'legacy-8',
    sequence: additional ? 10 : 8,
    type: 'RESOLVE_ABILITY',
    playerId: 'p1',
    timestamp: 20,
    payload: {
      pendingAbilityId: 'effect',
      abilityId,
      sourceCardId: 'source',
      step: 'MOVE_REVEALED_CHEER_CARD',
      movedCardIds: ['selected'],
      additionalCheerCardIds: extra,
      additionalCheerCount: extra.length,
      destination,
    },
  };
  const suffix: readonly GameAction[] = additional
    ? [
        {
          id: 'legacy-8',
          sequence: 8,
          type: 'RESOLVE_ABILITY',
          playerId: 'p1',
          timestamp: 20,
          payload: {
            abilityId,
            sourceCardId: 'source',
            step: 'ABILITY_USE',
            turnCount: before.turnCount,
          },
        },
        {
          id: 'legacy-9',
          sequence: 9,
          type: 'CHEER',
          playerId: 'p1',
          timestamp: 20,
          payload: { additional: true, automated: true, cheerCardIds: extra, cheerCount: 1 },
        },
        resolve,
      ]
    : [resolve];
  let expected = updatePlayer(before, 'p1', (player) => ({
    ...player,
    hand: { ...player.hand, cardIds: destination === 'HAND' ? ['selected'] : [] },
    waitingRoom: { ...player.waitingRoom, cardIds: additional ? ['selected'] : [] },
    mainDeck: {
      ...player.mainDeck,
      cardIds:
        destination === 'MAIN_DECK_TOP'
          ? ['selected', 'top', 'rest']
          : additional
            ? ['rest']
            : ['top', 'rest'],
    },
  }));
  expected = {
    ...expected,
    activeEffect: null,
    resolutionZone: { ...expected.resolutionZone, cardIds: extra, revealedCardIds: extra },
    liveResolution: { ...expected.liveResolution, firstPlayerCheerCardIds: ['selected', ...extra] },
    actionHistory: [...before.actionHistory, ...suffix],
    actionSequence: additional ? 10 : 8,
    eventLog: [
      ...before.eventLog,
      ...(additional
        ? [
            {
              sequence: 5,
              causedByActionId: 'legacy-9',
              event: {
                eventId: 'additional-cheer',
                eventType: T.ON_CHEER as const,
                playerId: 'p1',
                triggerPlayerId: 'p1',
                totalBlade: 1,
                revealedCardIds: extra,
                automated: true,
                additional: true,
                timestamp: 20,
              },
            },
          ]
        : []),
    ],
    eventSequence: additional ? 5 : 4,
  };
  // Independent runtime-shaped pair and chronology; never build actual using the migration.
  const actual: GameState = {
    ...expected,
    actionSequence: additional ? 11 : 9,
    actionHistory: [
      ...before.actionHistory,
      {
        id: 'legacy-8',
        sequence: 8,
        timestamp: 999,
        type: 'DISPATCH_TRIGGER_EVENT',
        playerId: 'p1',
        payload: { eventId: 'new-movement', triggerCondition: T.ON_REVEALED_CHEER_CARDS_MOVED },
      },
      ...suffix.map((action) => ({
        ...action,
        sequence: action.sequence + 1,
        id: `legacy-${action.sequence + 1}`,
      })),
    ],
    eventSequence: additional ? 6 : 5,
    eventLog: [
      ...before.eventLog,
      {
        sequence: 5,
        event: {
          eventId: 'new-movement',
          timestamp: 999,
          eventType: T.ON_REVEALED_CHEER_CARDS_MOVED,
          playerId: 'p1',
          controllerId: 'p1',
          triggerPlayerId: 'p1',
          movedCardIds: ['selected'],
          fromZone: Z.RESOLUTION_ZONE,
          toZone,
          destination,
          cause: {
            kind: 'CARD_EFFECT',
            playerId: 'p1',
            sourceCardId: 'source',
            abilityId,
            pendingAbilityId: 'effect',
          },
        },
      },
      ...(additional
        ? [
            {
              sequence: 6,
              causedByActionId: 'legacy-10',
              event: {
                eventId: 'additional-cheer',
                eventType: T.ON_CHEER as const,
                playerId: 'p1',
                triggerPlayerId: 'p1',
                totalBlade: 1,
                revealedCardIds: extra,
                automated: true,
                additional: true,
                timestamp: 20,
              },
            },
          ]
        : []),
    ],
  };
  return {
    actual,
    input: {
      isJune2026Fixture: true,
      beforeSchemaVersion: LEGACY_GAME_STATE_SCHEMA_VERSION,
      afterSchemaVersion: LEGACY_GAME_STATE_SCHEMA_VERSION,
      before,
      expected,
      command: {
        type: GameCommandType.CONFIRM_EFFECT_STEP,
        playerId: 'p1',
        effectId: 'effect',
        timestamp: 20,
        ...(additional ? { selectedCardIds: ['selected'] } : { selectedCardId: 'selected' }),
      },
      decision: {
        decisionType: 'ACTIVE_EFFECT_SUBMITTED',
        abilityId,
        stepId,
        sourceCardObjectId: 'source',
      },
    },
  };
}

// The existing harness drops these IDs. Raw links are separately checked before comparison.
function comparable(state: GameState) {
  return {
    ...state,
    actionHistory: state.actionHistory.map(({ id, timestamp, payload, ...action }) => {
      const { eventId, ...facts } = payload;
      return { ...action, payload: facts };
    }),
    eventLog: state.eventLog.map(({ event, ...entry }) => {
      const { eventId, timestamp, ...facts } = event;
      return { ...entry, event: facts };
    }),
  };
}

describe('June V1 revealed-cheer movement comparison history', () => {
  it.each(cases)(
    'adds only the missing %s event/dispatch pair before follow-up effects',
    (destination) => {
      const { input, actual } = sample(destination);
      const snapshot = structuredClone(input);
      const aligned = withLegacyReplayHistory(input);
      expect(comparable(aligned)).toEqual(comparable(actual));
      expect(getLegacyReplayHistoryLinkIssues(aligned, actual)).toEqual([]);
      expect(input).toEqual(snapshot);
      expect(withLegacyReplayHistory({ ...input, expected: aligned })).toBe(aligned);
      expect(comparable(aligned)).not.toEqual(comparable(input.expected));
      expect(getLegacyReplayHistoryLinkIssues(aligned, input.expected)).not.toEqual([]);
    }
  );

  it.each([
    ['event type', { eventType: T.ON_ENTER_HAND }],
    ['owner', { playerId: 'p2' }],
    ['controller', { controllerId: 'p2' }],
    ['trigger player', { triggerPlayerId: 'p2' }],
    ['source zone', { fromZone: Z.HAND }],
    ['destination zone', { toZone: Z.MAIN_DECK }],
    ['destination', { destination: 'MAIN_DECK_TOP' }],
    ['moved cards', { movedCardIds: ['other'] }],
    ['extra fact', { unrelated: true }],
  ])('rejects wrong movement %s', (_label, patch) => {
    const { input, actual } = sample('HAND');
    const wrong = {
      ...actual,
      eventLog: actual.eventLog.map((entry, index) =>
        index === 1 ? { ...entry, event: { ...entry.event, ...patch } } : entry
      ),
    } as GameState;
    expect(getLegacyReplayHistoryLinkIssues(withLegacyReplayHistory(input), wrong)).not.toEqual([]);
    expect(comparable(withLegacyReplayHistory(input))).not.toEqual(comparable(wrong));
  });

  it.each([
    ['kind', { kind: 'RULE_ACTION' }],
    ['player', { playerId: 'p2' }],
    ['source', { sourceCardId: 'other' }],
    ['ability', { abilityId: 'other' }],
    ['pending reference', { pendingAbilityId: 'wrong-effect' }],
  ])('rejects wrong cause %s before volatile-ID normalization', (_label, patch) => {
    const { input, actual } = sample('HAND');
    const wrong = {
      ...actual,
      eventLog: actual.eventLog.map((entry, index) =>
        index === 1
          ? {
              ...entry,
              event: {
                ...entry.event,
                cause: { ...(entry.event as { cause: object }).cause, ...patch },
              },
            }
          : entry
      ),
    } as GameState;
    expect(getLegacyReplayHistoryLinkIssues(withLegacyReplayHistory(input), wrong)).not.toEqual([]);
  });

  it('rejects broken volatile event references even when the normalizer would erase the difference', () => {
    const { input, actual } = sample('HAND');
    const aligned = withLegacyReplayHistory(input);
    const wrong = {
      ...actual,
      actionHistory: actual.actionHistory.map((action, index) =>
        index === 1 ? { ...action, payload: { ...action.payload, eventId: 'old-cheer' } } : action
      ),
    };
    expect(comparable(aligned)).toEqual(comparable(wrong));
    expect(getLegacyReplayHistoryLinkIssues(aligned, wrong)).toEqual([
      'revealed-cheer movement dispatch link mismatch',
    ]);
  });

  it('requires exactly one matching dispatch with the correct sequence, player and trigger', () => {
    const { input, actual } = sample('WAITING_ROOM');
    const aligned = withLegacyReplayHistory(input);
    const dispatch = actual.actionHistory[1]!;
    const wrongStates: GameState[] = [
      { ...actual, actionHistory: actual.actionHistory.filter((_, index) => index !== 1) },
      { ...actual, actionHistory: [...actual.actionHistory, dispatch] },
      ...[
        { sequence: 100 },
        { playerId: 'p2' },
        { type: 'RULE_ACTION' },
        { payload: { ...dispatch.payload, triggerCondition: T.ON_ENTER_HAND } },
        { payload: { ...dispatch.payload, extra: true } },
      ].map(
        (patch) =>
          ({
            ...actual,
            actionHistory: actual.actionHistory.map((action, index) =>
              index === 1 ? { ...action, ...patch } : action
            ),
          }) as GameState
      ),
      { ...actual, eventLog: [...actual.eventLog, actual.eventLog[1]!] },
    ];
    for (const wrong of wrongStates)
      expect(getLegacyReplayHistoryLinkIssues(aligned, wrong)).not.toEqual([]);
  });

  it.each(cases)(
    'preserves full state/history comparison outside the added %s pair',
    (destination) => {
      const { input, actual } = sample(destination);
      const baseline = comparable(withLegacyReplayHistory(input));
      const wrongStates: GameState[] = [
        { ...actual, turnCount: actual.turnCount + 1 },
        { ...actual, actionSequence: actual.actionSequence + 1 },
        { ...actual, eventSequence: actual.eventSequence + 1 },
        {
          ...actual,
          actionHistory: actual.actionHistory.map((action, index) =>
            index === 0 ? { ...action, payload: { old: false } } : action
          ),
        },
        {
          ...actual,
          eventLog: actual.eventLog.map((entry, index) =>
            index === 0 ? { ...entry, event: { ...entry.event, triggerPlayerId: 'p2' } } : entry
          ),
        },
        { ...actual, actionHistory: [...actual.actionHistory].reverse() },
        updatePlayer(actual, 'p2', (player) => ({
          ...player,
          hand: { ...player.hand, cardIds: ['drift'] },
        })),
        { ...actual, resolutionZone: { ...actual.resolutionZone, cardIds: ['drift'] } },
      ];
      for (const wrong of wrongStates) expect(baseline).not.toEqual(comparable(wrong));
    }
  );

  it.each(cases)(
    'does not migrate new formats, unrelated commands or unproven %s movement',
    (destination) => {
      const { input, actual } = sample(destination);
      const changedEffect = (patch: Partial<NonNullable<GameState['activeEffect']>>) => ({
        ...input,
        before: { ...input.before, activeEffect: { ...input.before.activeEffect!, ...patch } },
      });
      const inputs: Comparison[] = [
        { ...input, isJune2026Fixture: false },
        { ...input, beforeSchemaVersion: GAME_STATE_SCHEMA_VERSION },
        { ...input, afterSchemaVersion: GAME_STATE_SCHEMA_VERSION },
        { ...input, decision: { ...input.decision, abilityId: 'other' } },
        { ...input, decision: { ...input.decision, stepId: 'other' } },
        { ...input, decision: { ...input.decision, sourceCardObjectId: 'other' } },
        changedEffect({ metadata: { destination, cheerRevealedCardSelection: false } }),
        changedEffect({ selectableCardIds: [] }),
        {
          ...input,
          command: {
            type: GameCommandType.CONFIRM_EFFECT_STEP,
            playerId: 'p1',
            effectId: 'effect',
            timestamp: 20,
            selectedCardId: null,
            selectedCardIds: [],
          },
        },
        {
          ...input,
          before: {
            ...input.before,
            resolutionZone: { ...input.before.resolutionZone, revealedCardIds: [] },
          },
        },
        {
          ...input,
          before: {
            ...input.before,
            liveResolution: { ...input.before.liveResolution, firstPlayerCheerCardIds: [] },
          },
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
            resolutionZone: { ...input.expected.resolutionZone, cardIds: ['selected'] },
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
      if (destination === 'WAITING_ROOM')
        inputs.push({
          ...input,
          expected: {
            ...input.expected,
            eventLog: input.expected.eventLog.map((entry, index) =>
              index === 1 ? { ...entry, causedByActionId: 'unrelated-action' } : entry
            ),
          },
        });
      for (const candidate of inputs)
        expect(withLegacyReplayHistory(candidate)).toBe(candidate.expected);
    }
  );
});

import { useGameStore } from '@/store/gameStore';
import { addLiveModifier } from '@game/domain/rules/live-modifiers';
import { buildEffectFeedbackEvents } from '@game/online/effect-feedback';
import { projectPlayerViewState } from '@game/online/projector';
import { HeartColor } from '@game/shared/types/enums';

// Importing this module must not prepare or mount another board.
export function snapshot() {
  const state = useGameStore.getState();
  const effect = state.gameSession.state?.activeEffect;
  return {
    events: state.publicBattleLog.events.filter((event) => event.type === 'EffectFeedback'),
    view: state.playerViewState,
    active: !!effect,
    deadline: effect?.publicCardSelectionAutoAdvanceAt ?? effect?.publicEffectChoiceAutoAdvanceAt,
  };
}

/** Browser-only presentation fixture for player-level modifiers. This does not
 * mutate authority or implement a new ability. Real SCORE/REQUIREMENT commands
 * are exercised separately; here the same authority delta builder supplies facts. */
export function previewZoneFeedback() {
  const state = useGameStore.getState();
  const before = state.gameSession.state!;
  let after = addLiveModifier(before, {
    kind: 'HEART',
    target: 'PLAYER',
    playerId: 'p1',
    sourceCardId: 'source',
    hearts: [
      { color: HeartColor.BLUE, count: 2 },
      { color: HeartColor.YELLOW, count: 1 },
    ],
  });
  after = addLiveModifier(after, {
    kind: 'BLADE',
    target: 'PLAYER',
    playerId: 'p1',
    sourceCardId: 'source',
    countDelta: 1,
  });
  after = addLiveModifier(after, {
    kind: 'SCORE',
    playerId: 'p1',
    sourceCardId: 'source',
    countDelta: 1,
  });
  // The isolated sample represents a completed result, without the unrelated
  // pending member ability obscuring its region. Authority remains untouched.
  after = { ...after, activeEffect: null, waitingForInput: false, waitingPlayerId: null };
  const seq = state.publicBattleLog.currentPublicSeq + 1;
  const view = projectPlayerViewState(after, state.viewingPlayerId!);
  const events = buildEffectFeedbackEvents(before, after, {
    source: 'SYSTEM',
    isPublicCard: (_game, id) => id === 'source',
  }).map((event, i) => ({
    ...event,
    eventId: `zone-preview:${seq}:${i}`,
    matchId: view.match.matchId,
    seq,
    timestamp: Date.now(),
  }));
  useGameStore.setState({
    playerViewState: { ...view, match: { ...view.match, seq } },
    publicBattleLog: {
      ...state.publicBattleLog,
      currentPublicSeq: seq,
      cursorSeq: seq,
      events: [...state.publicBattleLog.events, ...events],
    },
  });
  return events;
}

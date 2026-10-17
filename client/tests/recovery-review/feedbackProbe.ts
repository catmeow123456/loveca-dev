import { useGameStore } from '@/store/gameStore';

// Read-only inspection; importing this module must not prepare or mount another board.
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

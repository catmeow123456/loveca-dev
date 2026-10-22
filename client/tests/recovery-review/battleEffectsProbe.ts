import { useGameStore } from '@/store/gameStore';

/** Read-only observations from the same store as the shared board. */
export function snapshot() {
  const store = useGameStore.getState();
  return {
    view: store.playerViewState,
    occlusions: store.ui.battleAnimationOcclusions,
    activations: store.ui.logs.filter((log) => log.message === '发动起动效果').length,
  };
}

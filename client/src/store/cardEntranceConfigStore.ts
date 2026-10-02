import { create } from 'zustand';

/** Public platform policy, separate from the player's persisted opt-out. */
export const useCardEntranceConfigStore = create<{ enabled: boolean }>(() => ({ enabled: true }));

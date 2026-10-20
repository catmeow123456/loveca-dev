import { useGameStore } from '@/store/gameStore';
import { SlotPosition } from '@game/shared/types/enums';
const store = () => useGameStore.getState();
// Read-only inspection for the isolated local browser verification page.
export function snapshot() {
  const s = store();
  const view = s.playerViewState;
  return {
    matchId: view?.match.matchId,
    seq: view?.match.seq,
    active: !!view?.activeEffect,
    activationCount: s.ui.logs.filter((l) => l.message === '发动起动效果').length,
    sourceIds: Object.keys(view?.objects ?? {}),
    hand: s.getSeatZoneCardIds('FIRST', 'HAND'),
    waiting: s.getSeatZoneCardIds('FIRST', 'WAITING_ROOM'),
  };
}
export const tapSource = (slot = SlotPosition.CENTER) => store().tapMember('source', slot);
export const moveSourceToLeft = () =>
  store().moveMemberToSlot('source', SlotPosition.CENTER, SlotPosition.LEFT);

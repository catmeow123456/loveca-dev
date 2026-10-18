import { useCallback } from 'react';
import { GameCommandType } from '@game/application/game-commands';
import type { PlayerViewState, ViewCommandHint } from '@game/online';
import type { SlotPosition } from '@game/shared/types/enums';
import { useGameStore } from '@/store/gameStore';
import { useKeyedState } from './useKeyedState';
import {
  getMemberOverwriteOption,
  type MemberOverwriteOption,
  type MemberOverwritePaymentChoice,
} from '@/lib/memberOverwriteChoice';

function contextKey(
  view: PlayerViewState | null,
  hint: ViewCommandHint | null,
  enabled: boolean
): string {
  return JSON.stringify([
    view?.match.matchId,
    view?.match.viewerSeat,
    view?.match.seq,
    view?.match.manualOperation.mode,
    hint,
    enabled,
  ]);
}

/** A local, unsubmitted choice shared by all ordinary hand-to-stage entry points. */
export function useMemberOverwriteChoice(enabled: boolean) {
  const view = useGameStore((state) => state.playerViewState);
  const hint = useGameStore((state) => state.getCommandHint(GameCommandType.PLAY_MEMBER_TO_SLOT));
  const playMemberToSlot = useGameStore((state) => state.playMemberToSlot);
  const key = contextKey(view, hint, enabled);
  const [selection, setSelection] = useKeyedState<
    | (MemberOverwriteOption & {
        readonly cardId: string;
        readonly targetSlot: SlotPosition;
      })
    | null
  >(key, null);

  const requestPlayMember = useCallback(
    (cardId: string, targetSlot: SlotPosition) => {
      const option = enabled ? getMemberOverwriteOption(hint, `obj_${cardId}`, targetSlot) : null;
      if (option) {
        setSelection({ ...option, cardId, targetSlot });
        return { success: false, pending: true };
      }
      return playMemberToSlot(cardId, targetSlot);
    },
    [enabled, hint, playMemberToSlot, setSelection]
  );

  const choose = (relayMode: MemberOverwritePaymentChoice['relayMode']) => {
    const store = useGameStore.getState();
    const latestHint = store.getCommandHint(GameCommandType.PLAY_MEMBER_TO_SLOT);
    const current = selection;
    setSelection(null);
    // Check again at the click boundary; a remote snapshot can arrive before React rerenders.
    if (
      !current ||
      key !== contextKey(store.playerViewState, latestHint, enabled) ||
      !current.choices.some((choice) => choice.relayMode === relayMode)
    )
      return;
    playMemberToSlot(current.cardId, current.targetSlot, { relayMode });
  };

  return { selection, requestPlayMember, choose, cancel: () => setSelection(null) };
}

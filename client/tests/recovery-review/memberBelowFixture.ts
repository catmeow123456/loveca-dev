import { prepareCheer, cheerReviewStore } from './cheerFixture';
import { createCardInstance, isLiveCardData, isMemberCardData } from '@game/domain/entities/card';
import { registerCards, updatePlayer } from '@game/domain/entities/game';
import { addMemberBelowMember, placeCardInSlot } from '@game/domain/entities/zone';
import { EffectWindowType, GamePhase, SlotPosition, SubPhase } from '@game/shared/types/enums';

export function prepareMemberBelow(count = 2) {
  prepareCheer();
  const store = cheerReviewStore.getState();
  const session = store.gameSession;
  let state = session.state!;
  const original = state.cardRegistry.get('member-yellow')!.data;
  if (!isMemberCardData(original)) throw new Error('Expected member fixture');
  const data = { ...original, nameCn: original.name };
  const originalLive = state.cardRegistry.get('live-0')!.data;
  if (!isLiveCardData(originalLive)) throw new Error('Expected LIVE fixture');
  const live = { ...originalLive, nameCn: originalLive.name };
  store.loadCardData([...store.cardDataRegistry.values(), data, live]);
  const below = Array.from({ length: count }, (_, i) =>
    createCardInstance(i === 1 ? live : data, 'p1', `below-${i}`)
  );
  const opponent = createCardInstance(data, 'p2', 'opponent-stage');
  const opponentBelow = createCardInstance(data, 'p2', 'opponent-below');
  state = registerCards(state, [...below, opponent, opponentBelow]);
  state = updatePlayer(state, 'p1', (player) => ({
    ...player,
    memberSlots: below.reduce(
      (slots, card) => addMemberBelowMember(slots, SlotPosition.LEFT, card.instanceId),
      player.memberSlots
    ),
  }));
  state = updatePlayer(state, 'p2', (player) => ({
    ...player,
    memberSlots: addMemberBelowMember(
      placeCardInSlot(player.memberSlots, SlotPosition.CENTER, opponent.instanceId),
      SlotPosition.CENTER,
      opponentBelow.instanceId
    ),
  }));
  state = {
    ...state,
    currentPhase: GamePhase.MAIN_PHASE,
    currentSubPhase: SubPhase.NONE,
    effectWindowType: EffectWindowType.NONE,
  };
  session.restoreRuntimeState({ authorityState: state, currentPublicSeq: 0 });
  store.syncState();
}

export function clearMemberBelow() {
  const store = cheerReviewStore.getState();
  const state = updatePlayer(store.gameSession.state!, 'p1', (player) => ({
    ...player,
    memberSlots: {
      ...player.memberSlots,
      memberBelow: { ...player.memberSlots.memberBelow, LEFT: [] },
    },
  }));
  store.gameSession.restoreRuntimeState({ authorityState: state, currentPublicSeq: 0 });
  store.syncState();
}

export function memberBelowOutcome() {
  const store = cheerReviewStore.getState();
  return {
    actions: store.gameSession.state!.actionSequence,
    selected: store.ui.selectedCardId,
    slots: store.gameSession.state!.players[0].memberSlots,
  };
}

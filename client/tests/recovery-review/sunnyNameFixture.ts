import { createCardInstance, type MemberCardData } from '@game/domain/entities/card';
import {
  emitGameEvent,
  registerCards,
  updatePlayer,
  type GameState,
} from '@game/domain/entities/game';
import { createLiveStartEvent } from '@game/domain/events/game-events';
import { placeCardInSlot, removeCardFromSlot } from '@game/domain/entities/zone';
import { getMemberEffectiveBladeCount } from '@game/domain/rules/live-modifiers';
import {
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '@game/application/card-effect-runner';
import { CardType, SlotPosition } from '@game/shared/types/enums';
import { getNovember07LiveData } from '../../../tests/helpers/november-07-draft-effects';
import { prepareCheer, cheerReviewStore } from './cheerFixture';

// Isolated browser position: the LIVE uses the authorized export fixture;
// deliberately effectless member fixtures isolate the name-comparison choice.
export function prepareSunnyNameChoice(equalResults = false) {
  prepareCheer(true);
  const store = cheerReviewStore.getState();
  const session = store.gameSession;
  const memberData: MemberCardData = {
    cardType: CardType.MEMBER,
    cardCode: 'TEST-SUNNY-DUO',
    name: '星空凛&小泉花阳',
    groupNames: ['μ’s'],
    cost: 15,
    blade: 7,
    hearts: [],
  };
  const opponentData: MemberCardData[] = (
    equalResults ? ['星空凛', '小泉花阳'] : ['星空凛', '星空凛', '小泉花阳']
  ).map((name, index) => ({ ...memberData, cardCode: `TEST-SUNNY-${index}`, name }));
  const opponents = opponentData.map((data, index) =>
    createCardInstance(data, 'p2', `sunny-opponent-${index}`)
  );
  const sunnyData = getNovember07LiveData('PL!-bp8-024-L');
  let state = registerCards(session.state!, [
    createCardInstance(sunnyData, 'p1', 'live-0'),
    createCardInstance(memberData, 'p1', 'member-green'),
    ...opponents,
  ]);
  state = updatePlayer(state, 'p1', (player) => ({
    ...player,
    memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.CENTER),
  }));
  state = updatePlayer(state, 'p2', (player) => ({
    ...player,
    memberSlots: opponents.reduce(
      (slots, card, index) =>
        placeCardInSlot(
          slots,
          [SlotPosition.LEFT, SlotPosition.CENTER, SlotPosition.RIGHT][index],
          card.instanceId
        ),
      player.memberSlots
    ),
  }));
  state = {
    ...state,
    isStarted: true,
    manualOperationMode: 'RULES',
    liveResolution: { ...state.liveResolution, liveModifiers: [] },
  };
  const event = createLiveStartEvent('p1', ['live-0']);
  state = resolvePendingCardEffects(
    enqueueTriggeredCardEffects(emitGameEvent(state, event), [event.eventType])
  ).gameState;
  (session as unknown as { authorityState: GameState }).authorityState = state;
  store.loadCardData([...store.cardDataRegistry.values(), sunnyData, memberData, ...opponentData]);
  store.syncState();
  return store.confirmEffectStep(state.activeEffect!.id, 'member-green');
}

export function sunnyNameOutcome() {
  const state = cheerReviewStore.getState().gameSession.state!;
  return {
    blade: getMemberEffectiveBladeCount(state, 'p1', 'member-green'),
    stepId: state.activeEffect?.stepId ?? null,
    selectedName: [...state.actionHistory]
      .reverse()
      .find((action) => action.payload.selectedMemberName)?.payload.selectedMemberName,
  };
}

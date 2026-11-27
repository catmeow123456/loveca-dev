import { S_PB2_002_ACTIVATED_BOTTOM_AQOURS_LIVES_ACTIVATE_ENERGY_ABILITY_ID as ABILITY } from '@game/application/card-effects/ability-ids';
import { createActivateAbilityCommand } from '@game/application/game-commands';
import { createCardInstance } from '@game/domain/entities/card';
import { registerCards, updatePlayer } from '@game/domain/entities/game';
import { placeCardInSlot } from '@game/domain/entities/zone';
import {
  EffectWindowType,
  FaceState,
  GamePhase,
  OrientationState,
  SlotPosition,
  SubPhase,
} from '@game/shared/types/enums';
import { getNovember27MemberData } from '../../../tests/helpers/november-27-draft-effects';
import { cheerReviewStore, prepareCheer } from './cheerFixture';

const SOURCE = 'riko-zero-cost-source';

export function prepareRikoZeroCost() {
  prepareCheer();
  const store = cheerReviewStore.getState();
  const data = getNovember27MemberData('PL!S-pb2-002');
  store.loadCardData([...store.cardDataRegistry.values(), data]);
  const session = store.gameSession;
  let state = updatePlayer(
    registerCards(session.state!, [createCardInstance(data, 'p1', SOURCE)]),
    'p1',
    (player) => ({
      ...player,
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.LEFT, SOURCE, {
        face: FaceState.FACE_UP,
        orientation: OrientationState.ACTIVE,
      }),
      waitingRoom: { ...player.waitingRoom, cardIds: [] },
    })
  );
  state = updatePlayer(state, 'p2', (player) => ({
    ...player,
    mainDeck: { ...player.mainDeck, cardIds: player.hand.cardIds },
    hand: { ...player.hand, cardIds: [] },
  }));
  session.restoreRuntimeState({
    authorityState: {
      ...state,
      currentPhase: GamePhase.MAIN_PHASE,
      currentSubPhase: SubPhase.NONE,
      effectWindowType: EffectWindowType.NONE,
      activePlayerIndex: 0,
      activeEffect: null,
      liveResolution: { ...state.liveResolution, isInLive: false, performingPlayerId: null },
    },
    currentPublicSeq: 0,
  });
  reopenRikoZeroCost();
}

export function reopenRikoZeroCost() {
  const store = cheerReviewStore.getState();
  const result = store.gameSession.executeCommand(
    createActivateAbilityCommand('p1', SOURCE, ABILITY)
  );
  if (!result.success) throw new Error(result.error ?? 'Unable to open Riko activation');
  store.syncState();
}

export function rikoZeroCostOutcome() {
  const state = cheerReviewStore.getState().gameSession.state!;
  return {
    active: state.activeEffect !== null,
    paid: state.actionHistory
      .filter((action) => action.type === 'PAY_COST' && action.payload.abilityId === ABILITY)
      .map((action) => action.payload.movedCardIds),
  };
}

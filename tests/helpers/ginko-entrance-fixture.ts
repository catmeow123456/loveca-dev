import { createGameSession } from '../../src/application/game-session';
import {
  createActivateAbilityCommand,
  createConfirmEffectStepCommand,
  createPlayMemberToSlotCommand,
  GameCommandType,
} from '../../src/application/game-commands';
import { HS_BP8_004_ACTIVATED_DISCARD_LOW_COST_HASUNOSORA_GAIN_ON_ENTER_ABILITY_ID as ACTIVATED } from '../../src/application/card-effects/ability-ids';
import { createCardInstance, type MemberCardData } from '../../src/domain/entities/card';
import { registerCards, updatePlayer, type GameState } from '../../src/domain/entities/game';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import {
  CardType,
  FaceState,
  GamePhase,
  OrientationState,
  SlotPosition,
  SubPhase,
  TurnType,
} from '../../src/shared/types/enums';
import { member, live } from './card-effect-zone-fixture';

export function prepareGinkoScenario(
  options: {
    mode?: 'LOCAL' | 'REMOTE';
    relay?: 'kaho' | 'other' | 'none' | 'cover';
    sourceCode?: string;
    sourceOverrides?: Partial<MemberCardData>;
    now?: () => number;
    sourceIsLive?: boolean;
  } = {}
) {
  const session = createGameSession({ cardEntrance: options.mode ?? 'REMOTE', now: options.now });
  const initial = session.createGame('ginko-flowers', 'p1', '吟子', 'p2', '对手');
  const relay = options.relay ?? 'kaho';
  const cards = [
    member('ginko', { cardCode: 'PL!HS-bp8-004-SEC' }),
    options.sourceIsLive
      ? live('source')
      : member('source', {
          cardCode: options.sourceCode ?? 'PL!HS-PR-001-PR',
          ...options.sourceOverrides,
        }),
    member('relay', { cardCode: relay === 'other' ? 'PL!HS-bp1-006-P' : 'PL!HS-bp1-001-P' }),
    member('neighbor', { cardCode: 'PL!HS-bp2-010-N' }),
    member('opponent', {}, 'p2'),
    ...Array.from({ length: 20 }, (_, i) => member(`deck-${i}`)),
    ...Array.from({ length: 17 }, (_, i) =>
      createCardInstance(
        {
          cardCode: 'ENERGY',
          name: '能量',
          cardType: CardType.ENERGY,
        },
        'p1',
        `energy-${i}`
      )
    ),
  ];
  let state = registerCards(initial, cards);
  const active = { face: FaceState.FACE_UP, orientation: OrientationState.ACTIVE };
  state = updatePlayer(state, 'p1', (p) => ({
    ...p,
    hand: { ...p.hand, cardIds: ['ginko', 'source'] },
    mainDeck: { ...p.mainDeck, cardIds: Array.from({ length: 20 }, (_, i) => `deck-${i}`) },
    energyZone: {
      ...p.energyZone,
      cardIds: Array.from({ length: 17 }, (_, i) => `energy-${i}`),
      cardStates: new Map(Array.from({ length: 17 }, (_, i) => [`energy-${i}`, active])),
    },
    memberSlots:
      relay === 'none'
        ? placeCardInSlot(p.memberSlots, SlotPosition.LEFT, 'neighbor', {
            ...active,
            orientation: OrientationState.WAITING,
          })
        : placeCardInSlot(
            placeCardInSlot(p.memberSlots, SlotPosition.LEFT, 'neighbor', {
              ...active,
              orientation: OrientationState.WAITING,
            }),
            SlotPosition.CENTER,
            'relay',
            active
          ),
  }));
  state = updatePlayer(state, 'p2', (p) => ({
    ...p,
    memberSlots: placeCardInSlot(p.memberSlots, SlotPosition.CENTER, 'opponent', active),
  }));
  state = {
    ...state,
    currentPhase: GamePhase.MAIN_PHASE,
    currentSubPhase: SubPhase.NONE,
    currentTurnType: TurnType.FIRST_PLAYER_TURN,
    isStarted: true,
    activePlayerIndex: 0,
    waitingForInput: false,
    waitingPlayerId: null,
    manualOperationMode: 'RULES',
  };
  (session as unknown as { authorityState: GameState }).authorityState = state;
  const ack = (playerId = 'p1', entranceId = session.state!.entranceRuntime!.pending!.id) =>
    session.executeCommand({
      type: GameCommandType.ACK_CARD_ENTRANCE,
      playerId,
      entranceId,
      timestamp: options.now?.() ?? Date.now(),
    });
  return {
    session,
    ack,
    play: () =>
      session.executeCommand(
        createPlayMemberToSlotCommand('p1', 'ginko', SlotPosition.CENTER, {
          relayMode: relay === 'none' || relay === 'cover' ? 'NONE' : 'SINGLE',
          ...(relay === 'none' || relay === 'cover'
            ? {}
            : { relayReplacementSlots: [SlotPosition.CENTER] }),
        })
      ),
    activate: () => session.executeCommand(createActivateAbilityCommand('p1', 'ginko', ACTIVATED)),
    discard: () =>
      session.executeCommand(
        createConfirmEffectStepCommand('p1', session.state!.activeEffect!.id, 'source')
      ),
  };
}

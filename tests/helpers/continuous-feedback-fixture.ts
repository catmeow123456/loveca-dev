import { createGameSession } from '../../src/application/game-session';
import {
  createActivateAbilityCommand,
  createConfirmEffectStepCommand,
  createTapMemberCommand,
  type GameCommand,
} from '../../src/application/game-commands';
import { PL_BP8_009_ACTIVATED_PAY_TWO_ENERGY_STACK_HAND_MEMBER_BELOW_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import { createCardInstance, type MemberCardData } from '../../src/domain/entities/card';
import { registerCards, updatePlayer, type GameState } from '../../src/domain/entities/game';
import { addMemberBelowMember, placeCardInSlot } from '../../src/domain/entities/zone';
import {
  CardType,
  FaceState,
  GamePhase,
  HeartColor,
  OrientationState,
  SlotPosition,
  SubPhase,
  TurnType,
} from '../../src/shared/types/enums';
import { getOctober31MemberData } from './october-31-draft-effects';

export type ContinuousFeedbackScenarioId = 'continuous-nico' | 'continuous-opponent';
const active = { face: FaceState.FACE_UP, orientation: OrientationState.ACTIVE };
const waiting = { ...active, orientation: OrientationState.WAITING };
let sequence = 0;

/** Initial state only; every subsequent change goes through a real GameSession command. */
export function prepareContinuousFeedbackScenario(
  scenario: ContinuousFeedbackScenarioId,
  options: { readonly sourceWaiting?: boolean } = {}
) {
  const session = createGameSession();
  session.createGame(`continuous-feedback-${++sequence}`, 'p1', '己方', 'p2', '对方');
  const nico = scenario === 'continuous-nico';
  // Numeric facts for the two existing Eri continuous abilities, from the October 31 export.
  const eri: MemberCardData = {
    cardCode: 'PL!-bp3-002-R',
    name: '绚濑绘里',
    cardType: CardType.MEMBER,
    cost: 9,
    blade: 1,
    groupNames: ["μ's"],
    unitName: 'BiBi',
    hearts: [
      { color: HeartColor.PINK, count: 1 },
      { color: HeartColor.YELLOW, count: 1 },
      { color: HeartColor.PURPLE, count: 2 },
    ],
  };
  const source = createCardInstance(
    nico ? getOctober31MemberData('PL!-bp8-009') : eri,
    'p1',
    'source'
  );
  const heartSourceData: MemberCardData = {
    ...eri,
    cardCode: 'PL!-pb1-002-R',
    cost: 13,
    blade: 3,
    hearts: [
      { color: HeartColor.PINK, count: 1 },
      { color: HeartColor.YELLOW, count: 2 },
      { color: HeartColor.PURPLE, count: 2 },
    ],
  };
  const heartSource = createCardInstance(heartSourceData, 'p1', 'heart-source');
  // Vanilla supporting cards also use numeric facts from the October 31 export.
  const support: Record<number, Pick<MemberCardData, 'cardCode' | 'name' | 'blade' | 'hearts'>> = {
    2: {
      cardCode: 'PL!-bp6-017-N',
      name: '小泉花阳',
      blade: 0,
      hearts: [
        { color: HeartColor.PINK, count: 1 },
        { color: HeartColor.YELLOW, count: 1 },
      ],
    },
    4: {
      cardCode: 'PL!-sd1-010-SD',
      name: '高坂穗乃果',
      blade: 1,
      hearts: [
        { color: HeartColor.PINK, count: 1 },
        { color: HeartColor.YELLOW, count: 1 },
      ],
    },
    5: {
      cardCode: 'PL!-pb1-021-PR',
      name: '南琴梨（南小鸟）',
      blade: 1,
      hearts: [
        { color: HeartColor.YELLOW, count: 2 },
        { color: HeartColor.PURPLE, count: 1 },
      ],
    },
    7: {
      cardCode: 'PL!-bp4-012-N',
      name: '南琴梨（南小鸟）',
      blade: 2,
      hearts: [
        { color: HeartColor.PINK, count: 1 },
        { color: HeartColor.YELLOW, count: 2 },
      ],
    },
  };
  const member = (id: string, cost: number, owner = 'p1') => {
    const data: MemberCardData = {
      ...support[cost]!,
      cardType: CardType.MEMBER,
      cost,
      groupNames: ["μ's"],
    };
    return createCardInstance(data, owner, id);
  };
  const below = [2, 4, 5].map((cost) => member(`below-${cost}`, cost));
  const hand = [member('new-cost', 7), member('same-cost', 7)];
  const opponent = member('opponent', 4, 'p2');
  const opponentWaiting = member('opponent-waiting', 2, 'p2');
  const energies = Array.from({ length: 4 }, (_, i) =>
    createCardInstance(
      {
        cardCode: 'LL-E-001-SD',
        name: '能量',
        cardType: CardType.ENERGY,
      },
      'p1',
      `energy-${i}`
    )
  );
  const deck = Array.from({ length: 4 }, (_, i) => member(`deck-${i}`, 2));
  const cards = [
    source,
    ...(nico ? [...below, ...hand] : [heartSource, opponent, opponentWaiting]),
    ...energies,
    ...deck,
  ];
  let state = registerCards(session.state!, cards);
  state = {
    ...state,
    currentPhase: GamePhase.MAIN_PHASE,
    currentSubPhase: SubPhase.NONE,
    currentTurnType: nico ? TurnType.FIRST_PLAYER_TURN : TurnType.SECOND_PLAYER_TURN,
    activePlayerIndex: nico ? 0 : 1,
    waitingPlayerId: null,
    waitingForInput: false,
    // Nico's ability is exercised under rules validation. The second fixture uses the
    // existing free-table orientation command solely to vary a public condition.
    manualOperationMode: nico ? 'RULES' : 'FREE',
  };
  state = updatePlayer(state, 'p1', (p) => {
    let slots = placeCardInSlot(
      p.memberSlots,
      SlotPosition.CENTER,
      source.instanceId,
      options.sourceWaiting ? waiting : active
    );
    if (nico)
      for (const card of below)
        slots = addMemberBelowMember(slots, SlotPosition.CENTER, card.instanceId);
    else slots = placeCardInSlot(slots, SlotPosition.LEFT, heartSource.instanceId, active);
    return {
      ...p,
      memberSlots: slots,
      hand: { ...p.hand, cardIds: nico ? hand.map((card) => card.instanceId) : [] },
      mainDeck: { ...p.mainDeck, cardIds: deck.map((card) => card.instanceId) },
      energyZone: {
        ...p.energyZone,
        cardIds: energies.map((card) => card.instanceId),
        cardStates: new Map(energies.map((card) => [card.instanceId, active])),
      },
    };
  });
  if (!nico)
    state = updatePlayer(state, 'p2', (p) => ({
      ...p,
      memberSlots: placeCardInSlot(
        placeCardInSlot(p.memberSlots, SlotPosition.LEFT, opponentWaiting.instanceId, waiting),
        SlotPosition.CENTER,
        opponent.instanceId,
        active
      ),
    }));
  (session as unknown as { authorityState: GameState }).authorityState = state;
  const nextCommand = (): GameCommand | null => {
    if (!nico) return createTapMemberCommand('p2', opponent.instanceId, SlotPosition.CENTER);
    const current = session.state!;
    const selected = current.players[0].hand.cardIds[0];
    if (!selected) return null;
    return current.activeEffect
      ? createConfirmEffectStepCommand('p1', current.activeEffect.id, selected)
      : createActivateAbilityCommand(
          'p1',
          source.instanceId,
          PL_BP8_009_ACTIVATED_PAY_TWO_ENERGY_STACK_HAND_MEMBER_BELOW_ABILITY_ID
        );
  };
  return { session, cards, nextCommand };
}

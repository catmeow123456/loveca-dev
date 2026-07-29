import { describe, expect, it } from 'vitest';
import {
  buildAiDecisionContract,
  getAiDecisionWitness,
  materializeAiDecisionCommand,
  sampleAiDecisionSelection,
  validateAiDecisionSelection,
} from '../../src/application/ai-decisions/decision-contract';
import {
  createGameState,
  registerCards,
  type ActiveEffectState,
  type GameState,
} from '../../src/domain/entities/game';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
  type EnergyCardData,
  type LiveCardData,
  type MemberCardData,
} from '../../src/domain/entities/card';
import { GameCommandType } from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import {
  BP5_003_ACTIVATED_ENERGY_DISCARD_BRANCH_ABILITY_ID,
  ELI_ACTIVATED_ABILITY_ID,
  HANAYO_ACTIVATED_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import {
  CardType,
  FaceState,
  GamePhase,
  HeartColor,
  OrientationState,
  SlotPosition,
  SubPhase,
} from '../../src/shared/types/enums';
import { assertCertifiedAiDecisionSurface } from '../helpers/ai-decision-contract';

const PLAYER_ID = 'ai-player';
const OPPONENT_ID = 'human-player';
const REVISION = 17;
const NOW = 50_000;

function createState(patch: Partial<GameState> = {}): GameState {
  return {
    ...createGameState('ai-contract-test', PLAYER_ID, 'AI', OPPONENT_ID, 'Human'),
    ...patch,
  };
}

function createEffect(patch: Partial<ActiveEffectState> = {}): ActiveEffectState {
  return {
    id: 'effect-1',
    abilityId: 'ability-1',
    sourceCardId: 'source-card',
    controllerId: PLAYER_ID,
    effectText: '测试效果',
    stepId: 'STEP_1',
    stepText: '请选择。',
    awaitingPlayerId: PLAYER_ID,
    ...patch,
  };
}

function createMemberData(cardCode: string, cost = 0): MemberCardData {
  return {
    cardCode,
    name: cardCode,
    cardType: CardType.MEMBER,
    cost,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function createLiveData(cardCode: string): LiveCardData {
  return {
    cardCode,
    name: cardCode,
    cardType: CardType.LIVE,
    score: 1,
    requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
  };
}

function createEnergyData(cardCode: string): EnergyCardData {
  return {
    cardCode,
    name: cardCode,
    cardType: CardType.ENERGY,
  };
}

function build(state: GameState) {
  const result = buildAiDecisionContract(state, PLAYER_ID, REVISION, NOW);
  expect(result.ok, result.ok ? undefined : result.detail).toBe(true);
  if (!result.ok) throw new Error(result.detail);
  return result.handle;
}

describe('AI Phase 1A typed decision contract', () => {
  it('uses contract-local card IDs for mulligan and materializes only after validation', () => {
    const base = createState({
      currentPhase: GamePhase.MULLIGAN_PHASE,
      currentSubPhase: SubPhase.MULLIGAN_FIRST_PLAYER,
    });
    const state = {
      ...base,
      players: [
        {
          ...base.players[0],
          hand: { ...base.players[0].hand, cardIds: ['secret-a', 'secret-b'] },
        },
        base.players[1],
      ],
    } satisfies GameState;

    const handle = build(state);
    expect(handle.contract.kind).toBe('MULLIGAN');
    expect(JSON.stringify(handle.contract)).not.toContain('secret-a');
    expect(JSON.stringify(handle.contract)).not.toContain('secret-b');

    const selection = { kind: 'MULLIGAN', candidateIds: ['candidate-2'] } as const;
    expect(validateAiDecisionSelection(handle, selection)).toEqual({ ok: true });
    expect(materializeAiDecisionCommand(handle, selection, NOW)).toEqual({
      ok: true,
      command: {
        type: GameCommandType.MULLIGAN,
        playerId: PLAYER_ID,
        cardIdsToMulligan: ['secret-b'],
        timestamp: NOW,
      },
    });
  });

  it('does not create a mulligan contract for the non-acting seat', () => {
    const state = createState({
      currentPhase: GamePhase.MULLIGAN_PHASE,
      currentSubPhase: SubPhase.MULLIGAN_FIRST_PLAYER,
    });
    const secondPlayerId = state.players[1]?.id;
    if (!secondPlayerId) throw new Error('missing second player');

    expect(buildAiDecisionContract(state, secondPlayerId, REVISION, NOW)).toEqual({
      ok: false,
      reason: 'NO_DECISION',
      detail: '当前换牌不由该席位处理',
    });
  });

  it('preserves the pending payment identity and supplies an exact-count witness', () => {
    const state = createState({
      pendingCostPayment: {
        id: 'payment-9',
        playerId: PLAYER_ID,
        source: 'PLAY_MEMBER',
        sourceCardId: 'member-1',
        targetSlot: SlotPosition.LEFT,
        baseCost: 2,
        finalEnergyCost: 2,
        relayDiscount: 0,
        replacedMemberCardId: null,
        payableEnergyCardIds: ['energy-a', 'energy-b', 'energy-c'],
      },
    });

    const handle = build(state);
    const witness = getAiDecisionWitness(handle);
    expect(witness).toEqual({
      kind: 'PAY_COST',
      candidateIds: ['candidate-1', 'candidate-2'],
    });
    expect(validateAiDecisionSelection(handle, witness!)).toEqual({ ok: true });
    expect(materializeAiDecisionCommand(handle, witness!, NOW)).toEqual({
      ok: true,
      command: {
        type: GameCommandType.CONFIRM_COST_PAYMENT,
        playerId: PLAYER_ID,
        paymentId: 'payment-9',
        energyCardIds: ['energy-a', 'energy-b'],
        timestamp: NOW,
      },
    });
  });

  it('creates and validates grouped ordered-card witnesses from shared runtime metadata', () => {
    const state = createState({
      activeEffect: createEffect({
        selectableCardIds: ['live-a', 'member-a', 'live-b'],
        selectableCardVisibility: 'PUBLIC',
        selectableCardMode: 'ORDERED_MULTI',
        minSelectableCards: 2,
        maxSelectableCards: 2,
        metadata: {
          publicCardSelectionConfirmation: {
            destination: 'HAND',
            groups: [
              { candidateCardIds: ['live-a', 'live-b'], minCount: 1, maxCount: 1 },
              { candidateCardIds: ['member-a'], minCount: 1, maxCount: 1 },
            ],
          },
        },
      }),
    });

    const handle = build(state);
    expect(JSON.stringify(handle.contract)).not.toContain('live-a');
    expect(JSON.stringify(handle.contract)).not.toContain('member-a');
    expect(JSON.stringify(handle.contract)).not.toContain('effect-1');
    const witness = getAiDecisionWitness(handle);
    expect(witness).toEqual({
      kind: 'SELECT_EFFECT_CARDS',
      candidateIds: ['candidate-1', 'candidate-2'],
    });
    expect(validateAiDecisionSelection(handle, witness!)).toEqual({ ok: true });
    expect(
      validateAiDecisionSelection(handle, {
        kind: 'SELECT_EFFECT_CARDS',
        candidateIds: ['candidate-1', 'candidate-3'],
      })
    ).toMatchObject({ ok: false });
    expect(materializeAiDecisionCommand(handle, witness!, NOW)).toMatchObject({
      ok: true,
      command: {
        type: GameCommandType.CONFIRM_EFFECT_STEP,
        selectedCardIds: ['live-a', 'member-a'],
      },
    });
  });

  it('materializes an empty ordered-card selection as an ordered list', () => {
    const handle = build(
      createState({
        activeEffect: createEffect({
          selectableCardIds: ['card-a', 'card-b'],
          selectableCardVisibility: 'PUBLIC',
          selectableCardMode: 'ORDERED_MULTI',
          minSelectableCards: 0,
          maxSelectableCards: 2,
        }),
      })
    );
    const selection = {
      kind: 'SELECT_EFFECT_CARDS',
      candidateIds: [],
    } as const;

    expect(validateAiDecisionSelection(handle, selection)).toEqual({ ok: true });
    expect(materializeAiDecisionCommand(handle, selection, NOW)).toMatchObject({
      ok: true,
      command: {
        type: GameCommandType.CONFIRM_EFFECT_STEP,
        selectedCardIds: [],
      },
    });
  });

  it('materializes skipping an ordered-card selection through the nullable single-card field', () => {
    const handle = build(
      createState({
        activeEffect: createEffect({
          selectableCardIds: ['card-a', 'card-b'],
          selectableCardVisibility: 'PUBLIC',
          selectableCardMode: 'ORDERED_MULTI',
          minSelectableCards: 2,
          maxSelectableCards: 2,
          canSkipSelection: true,
        }),
      })
    );
    const selection = {
      kind: 'SELECT_EFFECT_CARDS',
      candidateIds: [],
    } as const;

    expect(validateAiDecisionSelection(handle, selection)).toEqual({ ok: true });
    expect(materializeAiDecisionCommand(handle, selection, NOW)).toMatchObject({
      ok: true,
      command: {
        type: GameCommandType.CONFIRM_EFFECT_STEP,
        selectedCardId: null,
      },
    });
  });

  it('projects effect options through temporary IDs and keeps player-facing labels', () => {
    const handle = build(
      createState({
        activeEffect: createEffect({
          effectChoice: {
            mode: 'MULTI',
            options: [
              { id: 'internal-draw', text: '抽1张牌' },
              { id: 'internal-score', text: '分数+1', selectable: false },
              { id: 'internal-heart', text: '获得Heart' },
            ],
            minSelections: 1,
            maxSelections: 2,
            publicConfirmation: true,
          },
        }),
      })
    );

    expect(handle.contract).toMatchObject({
      kind: 'ACTIVE_EFFECT',
      input: {
        kind: 'OPTION_SELECTION',
        options: [
          { optionId: 'option-1', label: '抽1张牌' },
          { optionId: 'option-2', label: '获得Heart' },
        ],
      },
    });
    expect(JSON.stringify(handle.contract)).not.toContain('internal-draw');
    const selection = {
      kind: 'SELECT_EFFECT_OPTIONS',
      optionIds: ['option-1', 'option-2'],
    } as const;
    expect(materializeAiDecisionCommand(handle, selection, NOW)).toMatchObject({
      ok: true,
      command: {
        selectedEffectOptionIds: ['internal-draw', 'internal-heart'],
      },
    });
  });

  it('supplies valid number, slot, formation, and deadline witnesses', () => {
    const numberHandle = build(
      createState({
        activeEffect: createEffect({
          numericInput: { min: 2, max: 5, integerOnly: true },
        }),
      })
    );
    expect(getAiDecisionWitness(numberHandle)).toEqual({
      kind: 'SELECT_EFFECT_NUMBER',
      value: 2,
    });

    const slotHandle = build(
      createState({
        activeEffect: createEffect({
          selectableSlots: [SlotPosition.CENTER, SlotPosition.RIGHT],
        }),
      })
    );
    expect(getAiDecisionWitness(slotHandle)).toEqual({
      kind: 'SELECT_EFFECT_SLOT',
      slot: SlotPosition.CENTER,
    });

    const optionalSlotHandle = build(
      createState({
        activeEffect: createEffect({
          selectableSlots: [SlotPosition.CENTER, SlotPosition.RIGHT],
          canSkipSelection: true,
        }),
      })
    );
    const optionalSlotWitness = getAiDecisionWitness(optionalSlotHandle);
    expect(optionalSlotWitness).toEqual({ kind: 'CONFIRM_EFFECT' });
    expect(validateAiDecisionSelection(optionalSlotHandle, optionalSlotWitness!)).toEqual({
      ok: true,
    });
    expect(
      materializeAiDecisionCommand(optionalSlotHandle, optionalSlotWitness!, NOW)
    ).toMatchObject({
      ok: true,
      command: {
        type: GameCommandType.CONFIRM_EFFECT_STEP,
        effectId: 'effect-1',
      },
    });

    const formationHandle = build(
      createState({
        activeEffect: createEffect({
          stageFormation: {
            playerId: PLAYER_ID,
            slots: [
              {
                slot: SlotPosition.LEFT,
                originalSlot: SlotPosition.LEFT,
                cardId: 'member-left',
                energyBelowCount: 0,
                memberBelowCount: 0,
              },
              {
                slot: SlotPosition.CENTER,
                originalSlot: SlotPosition.CENTER,
                cardId: 'member-center',
                energyBelowCount: 0,
                memberBelowCount: 0,
              },
            ],
          },
        }),
      })
    );
    expect(getAiDecisionWitness(formationHandle)).toEqual({
      kind: 'SET_STAGE_FORMATION',
      placements: [
        { candidateId: 'candidate-1', toSlot: SlotPosition.LEFT },
        { candidateId: 'candidate-2', toSlot: SlotPosition.CENTER },
      ],
    });

    const deadlineHandle = build(
      createState({
        activeEffect: createEffect({
          publicCardSelectionAutoAdvanceAt: NOW,
        }),
      })
    );
    expect(
      materializeAiDecisionCommand(deadlineHandle, { kind: 'CONFIRM_DEADLINE' }, NOW)
    ).toMatchObject({
      ok: true,
      command: { publicCardSelectionAutoAdvanceAt: NOW },
    });
  });

  it('rejects an unsatisfiable forced effect instead of calling strategy code', () => {
    const result = buildAiDecisionContract(
      createState({
        activeEffect: createEffect({
          selectableCardMode: 'SINGLE',
          selectableCardIds: [],
          canSkipSelection: false,
        }),
      }),
      PLAYER_ID,
      REVISION,
      NOW
    );

    expect(result).toMatchObject({
      ok: false,
      reason: 'INVALID_STATE',
    });
  });

  it('treats legacy pendingChoice as invalid authority state instead of inventing an adapter', () => {
    const result = buildAiDecisionContract(
      createState({
        currentPhase: GamePhase.MAIN_PHASE,
        pendingChoice: {
          id: 'legacy-choice',
          playerId: PLAYER_ID,
          kind: 'SELECT_CARDS',
          sourceAbilityId: 'legacy-ability',
          candidateCardIds: ['legacy-card'],
          minCount: 1,
          maxCount: 1,
        },
      }),
      PLAYER_ID,
      REVISION,
      NOW
    );

    expect(result).toMatchObject({
      ok: false,
      reason: 'INVALID_STATE',
    });
    if (result.ok) throw new Error('expected invalid legacy pendingChoice state');
    expect(result.detail).toContain('没有权威命令');
  });

  it('samples only contract-valid selections', () => {
    const handle = build(
      createState({
        activeEffect: createEffect({
          selectableCardIds: ['a', 'b', 'c'],
          selectableCardMode: 'ORDERED_MULTI',
          minSelectableCards: 1,
          maxSelectableCards: 2,
        }),
      })
    );

    const values = [0.9, 0.1, 0.7, 0.2];
    let cursor = 0;
    const selection = sampleAiDecisionSelection(handle, () => values[cursor++ % values.length]!);
    expect(selection).not.toBeNull();
    expect(validateAiDecisionSelection(handle, selection!)).toEqual({ ok: true });
  });

  it('keeps the existing GameSession command validation as the final authority boundary', () => {
    const base = createState({
      currentPhase: GamePhase.LIVE_RESULT_PHASE,
      currentSubPhase: SubPhase.RESULT_SCORE_CONFIRM,
    });
    const state = {
      ...base,
      liveResolution: {
        ...base.liveResolution,
        playerScores: new Map([[PLAYER_ID, 4]]),
      },
    } satisfies GameState;
    assertCertifiedAiDecisionSurface(state, PLAYER_ID, 'SCORE_CONFIRMATION');
    const handle = build(state);
    const witness = getAiDecisionWitness(handle);
    const materialized = materializeAiDecisionCommand(handle, witness!, NOW);
    expect(materialized.ok).toBe(true);
    if (!materialized.ok) throw new Error(materialized.error);

    const session = createGameSession({ now: () => NOW });
    session.restoreRuntimeState({
      authorityState: state,
      currentPublicSeq: 0,
    });
    expect(session.executeCommand(materialized.command).success).toBe(true);
    expect(session.state?.liveResolution.scoreConfirmedBy).toContain(PLAYER_ID);
  });

  it('certifies success-LIVE selection and winner phase confirmation rule windows', () => {
    const live = createCardInstance(
      createLiveData('AI-CONTRACT-SUCCESS-LIVE'),
      PLAYER_ID,
      'success-live'
    );
    const registered = registerCards(
      createState({
        currentPhase: GamePhase.LIVE_RESULT_PHASE,
        currentSubPhase: SubPhase.RESULT_SETTLEMENT,
      }),
      [live]
    );
    const state = {
      ...registered,
      players: [
        {
          ...registered.players[0],
          liveZone: {
            ...registered.players[0].liveZone,
            cardIds: [live.instanceId],
            cardStates: new Map([
              [live.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
            ]),
          },
        },
        registered.players[1],
      ],
      liveResolution: {
        ...registered.liveResolution,
        liveResults: new Map([[live.instanceId, true]]),
        liveWinnerIds: [PLAYER_ID],
      },
    } satisfies GameState;

    const successHandle = assertCertifiedAiDecisionSurface(
      state,
      PLAYER_ID,
      'SUCCESS_LIVE_SELECTION'
    );
    const successWitness = getAiDecisionWitness(successHandle);
    const successCommand = materializeAiDecisionCommand(successHandle, successWitness!, NOW);
    expect(successCommand.ok).toBe(true);
    if (!successCommand.ok) throw new Error(successCommand.error);
    const settlementSession = createGameSession({ now: () => NOW });
    settlementSession.restoreRuntimeState({ authorityState: state, currentPublicSeq: 0 });
    expect(settlementSession.executeCommand(successCommand.command).success).toBe(true);

    const animationState = {
      ...state,
      currentSubPhase: SubPhase.RESULT_ANIMATION,
    } satisfies GameState;
    const phaseHandle = assertCertifiedAiDecisionSurface(
      animationState,
      PLAYER_ID,
      'PHASE_CONFIRMATION'
    );
    const phaseWitness = getAiDecisionWitness(phaseHandle);
    const phaseCommand = materializeAiDecisionCommand(phaseHandle, phaseWitness!, NOW);
    expect(phaseCommand.ok).toBe(true);
    if (!phaseCommand.ok) throw new Error(phaseCommand.error);
    const animationSession = createGameSession({ now: () => NOW });
    animationSession.restoreRuntimeState({ authorityState: animationState, currentPublicSeq: 0 });
    expect(animationSession.executeCommand(phaseCommand.command).success).toBe(true);
  });

  it('queries ordinary member plays with authoritative cost plans and materializes a real command', () => {
    const member = createCardInstance(
      createMemberData('AI-CONTRACT-MEMBER', 0),
      PLAYER_ID,
      'main-member'
    );
    const registered = registerCards(
      createState({
        currentPhase: GamePhase.MAIN_PHASE,
        currentSubPhase: SubPhase.NONE,
      }),
      [member]
    );
    const state = {
      ...registered,
      players: [
        {
          ...registered.players[0],
          hand: { ...registered.players[0].hand, cardIds: [member.instanceId] },
        },
        registered.players[1],
      ],
    } satisfies GameState;

    const handle = build(state);
    expect(handle.contract.kind).toBe('MAIN_PHASE');
    expect(JSON.stringify(handle.contract)).not.toContain(member.instanceId);
    if (handle.contract.kind !== 'MAIN_PHASE') throw new Error('expected main phase contract');
    const playAction = handle.contract.actions.find(
      (action) => action.kind === 'PLAY_MEMBER' && action.targetSlot === SlotPosition.LEFT
    );
    expect(playAction?.paymentPreview).toMatchObject({
      modifiedCost: 0,
      energyCost: 0,
      relayDiscount: 0,
    });
    const materialized = materializeAiDecisionCommand(
      handle,
      { kind: 'SELECT_MAIN_PHASE_ACTION', actionId: playAction!.actionId },
      NOW
    );
    expect(materialized.ok).toBe(true);
    if (!materialized.ok) throw new Error(materialized.error);

    const session = createGameSession({ now: () => NOW });
    session.restoreRuntimeState({ authorityState: state, currentPublicSeq: 0 });
    expect(session.executeCommand(materialized.command).success).toBe(true);
    expect(session.state?.players[0].memberSlots.slots.LEFT).toBe(member.instanceId);
  });

  it('offers a registered activated ability and materializes a command accepted by GameSession', () => {
    const source = createCardInstance(
      createMemberData('PL!-sd1-002-SD', 2),
      PLAYER_ID,
      'activated-source'
    );
    const registered = registerCards(
      createState({
        currentPhase: GamePhase.MAIN_PHASE,
        currentSubPhase: SubPhase.NONE,
      }),
      [source]
    );
    const state = {
      ...registered,
      players: [
        {
          ...registered.players[0],
          memberSlots: {
            ...registered.players[0].memberSlots,
            slots: {
              ...registered.players[0].memberSlots.slots,
              [SlotPosition.CENTER]: source.instanceId,
            },
            cardStates: new Map([
              [
                source.instanceId,
                {
                  orientation: OrientationState.ACTIVE,
                  face: FaceState.FACE_UP,
                },
              ],
            ]),
          },
        },
        registered.players[1],
      ],
    } satisfies GameState;

    const handle = build(state);
    expect(handle.contract.kind).toBe('MAIN_PHASE');
    expect(JSON.stringify(handle.contract)).not.toContain(source.instanceId);
    expect(JSON.stringify(handle.contract)).not.toContain(ELI_ACTIVATED_ABILITY_ID);
    if (handle.contract.kind !== 'MAIN_PHASE') throw new Error('expected main phase contract');
    const activateAction = handle.contract.actions.find(
      (action) => action.kind === 'ACTIVATE_ABILITY'
    );
    expect(activateAction?.kind).toBe('ACTIVATE_ABILITY');
    expect(activateAction?.label).toContain('休息室');
    const materialized = materializeAiDecisionCommand(
      handle,
      { kind: 'SELECT_MAIN_PHASE_ACTION', actionId: activateAction!.actionId },
      NOW
    );
    expect(materialized).toMatchObject({
      ok: true,
      command: {
        type: GameCommandType.ACTIVATE_ABILITY,
        cardId: source.instanceId,
        abilityId: ELI_ACTIVATED_ABILITY_ID,
      },
    });
    if (!materialized.ok) throw new Error(materialized.error);

    const session = createGameSession({ now: () => NOW });
    session.restoreRuntimeState({ authorityState: state, currentPublicSeq: 0 });
    expect(session.executeCommand(materialized.command).success).toBe(true);
    expect(session.state?.players[0].waitingRoom.cardIds).toContain(source.instanceId);
    expect(session.state?.activeEffect?.abilityId).toBe(ELI_ACTIVATED_ABILITY_ID);
  });

  it('omits a registered activated ability when its workflow preflight is unavailable', () => {
    const source = createCardInstance(
      createMemberData('PL!-sd1-008-SD', 4),
      PLAYER_ID,
      'unpayable-activated-source'
    );
    const registered = registerCards(
      createState({
        currentPhase: GamePhase.MAIN_PHASE,
        currentSubPhase: SubPhase.NONE,
      }),
      [source]
    );
    const state = {
      ...registered,
      players: [
        {
          ...registered.players[0],
          memberSlots: {
            ...registered.players[0].memberSlots,
            slots: {
              ...registered.players[0].memberSlots.slots,
              [SlotPosition.CENTER]: source.instanceId,
            },
            cardStates: new Map([
              [
                source.instanceId,
                {
                  orientation: OrientationState.ACTIVE,
                  face: FaceState.FACE_UP,
                },
              ],
            ]),
          },
        },
        registered.players[1],
      ],
    } satisfies GameState;

    const handle = build(state);
    expect(handle.contract.kind).toBe('MAIN_PHASE');
    if (handle.contract.kind !== 'MAIN_PHASE') throw new Error('expected main phase contract');
    expect(handle.contract.actions).toEqual([expect.objectContaining({ kind: 'END_MAIN_PHASE' })]);
    expect(JSON.stringify(handle.contract)).not.toContain(HANAYO_ACTIVATED_ABILITY_ID);
  });

  it('reports an explicit main-phase coverage gap when an activated ability lacks preflight', () => {
    const source = createCardInstance(
      createMemberData('PL!-bp5-003-P', 2),
      PLAYER_ID,
      'unregistered-activated-source'
    );
    const registered = registerCards(
      createState({
        currentPhase: GamePhase.MAIN_PHASE,
        currentSubPhase: SubPhase.NONE,
      }),
      [source]
    );
    const state = {
      ...registered,
      players: [
        {
          ...registered.players[0],
          memberSlots: {
            ...registered.players[0].memberSlots,
            slots: {
              ...registered.players[0].memberSlots.slots,
              [SlotPosition.CENTER]: source.instanceId,
            },
            cardStates: new Map([
              [
                source.instanceId,
                {
                  orientation: OrientationState.ACTIVE,
                  face: FaceState.FACE_UP,
                },
              ],
            ]),
          },
        },
        registered.players[1],
      ],
    } satisfies GameState;

    const result = buildAiDecisionContract(state, PLAYER_ID, REVISION, NOW);
    expect(result).toMatchObject({
      ok: false,
      reason: 'UNSUPPORTED_WINDOW',
    });
    if (result.ok) throw new Error('expected unsupported activated-ability window');
    expect(result.detail).toContain('preflight');
    expect(result.detail).not.toContain(BP5_003_ACTIVATED_ENERGY_DISCARD_BRANCH_ABILITY_ID);
  });

  it('confirms a zero-selection special member play through a complete preflight', () => {
    const source = createCardInstance(
      createMemberData('PL!N-bp7-011-P', 13),
      PLAYER_ID,
      'special-source'
    );
    const waitingMember = createCardInstance(
      createMemberData('SPECIAL-WAITING-MEMBER', 2),
      PLAYER_ID,
      'special-waiting-member'
    );
    const energies = Array.from({ length: 11 }, (_, index) =>
      createCardInstance(
        createEnergyData(`SPECIAL-ENERGY-${index}`),
        PLAYER_ID,
        `special-energy-${index}`
      )
    );
    const registered = registerCards(
      createState({
        currentPhase: GamePhase.MAIN_PHASE,
        currentSubPhase: SubPhase.NONE,
      }),
      [source, waitingMember, ...energies]
    );
    const state = {
      ...registered,
      pendingSpecialMemberPlay: {
        id: 'special-pending',
        playerId: PLAYER_ID,
        sourceCardId: source.instanceId,
        targetSlot: SlotPosition.LEFT,
        candidateCardIds: [waitingMember.instanceId],
        mode: 'N_BP7_011_WAITING_MEMBERS_COST_MINUS_TWO',
        printedCost: 13,
        specialPlayCost: 11,
      },
      players: [
        {
          ...registered.players[0],
          hand: { ...registered.players[0].hand, cardIds: [source.instanceId] },
          waitingRoom: {
            ...registered.players[0].waitingRoom,
            cardIds: [waitingMember.instanceId],
          },
          energyZone: {
            ...registered.players[0].energyZone,
            cardIds: energies.map(({ instanceId }) => instanceId),
            cardStates: new Map(
              energies.map(({ instanceId }) => [
                instanceId,
                { orientation: OrientationState.ACTIVE },
              ])
            ),
          },
        },
        registered.players[1],
      ],
    } satisfies GameState;

    const handle = build(state);
    expect(handle.contract).toMatchObject({
      kind: 'SPECIAL_MEMBER_PLAY',
      minSelections: 0,
      maxSelections: 0,
      canConfirm: true,
      canCancel: true,
      paymentPreview: { modifiedCost: 11, energyCost: 11, relayDiscount: 0 },
    });
    expect(JSON.stringify(handle.contract)).not.toContain('special-pending');
    expect(JSON.stringify(handle.contract)).not.toContain(source.instanceId);
    const selection = {
      kind: 'CONFIRM_SPECIAL_MEMBER_PLAY',
      candidateIds: [],
    } as const;
    const materialized = materializeAiDecisionCommand(handle, selection, NOW);
    expect(materialized).toMatchObject({
      ok: true,
      command: {
        type: GameCommandType.CONFIRM_SPECIAL_MEMBER_PLAY,
        pendingId: 'special-pending',
        selectedCardIds: [],
      },
    });
    if (!materialized.ok) throw new Error(materialized.error);

    const session = createGameSession({ now: () => NOW });
    session.restoreRuntimeState({ authorityState: state, currentPublicSeq: 0 });
    expect(session.executeCommand(materialized.command).success).toBe(true);
    expect(session.state?.players[0].memberSlots.slots.LEFT).toBe(source.instanceId);
    expect(session.state?.pendingSpecialMemberPlay).toBeNull();
  });

  it('offers only cancellation when a special member play cannot complete its cost', () => {
    const source = createCardInstance(
      createMemberData('PL!N-bp7-011-P', 13),
      PLAYER_ID,
      'unpayable-special-source'
    );
    const waitingMember = createCardInstance(
      createMemberData('UNPAYABLE-SPECIAL-WAITING', 2),
      PLAYER_ID,
      'unpayable-special-waiting'
    );
    const registered = registerCards(
      createState({
        currentPhase: GamePhase.MAIN_PHASE,
        currentSubPhase: SubPhase.NONE,
      }),
      [source, waitingMember]
    );
    const state = {
      ...registered,
      pendingSpecialMemberPlay: {
        id: 'unpayable-special-pending',
        playerId: PLAYER_ID,
        sourceCardId: source.instanceId,
        targetSlot: SlotPosition.LEFT,
        candidateCardIds: [waitingMember.instanceId],
        mode: 'N_BP7_011_WAITING_MEMBERS_COST_MINUS_TWO',
        printedCost: 13,
        specialPlayCost: 11,
      },
      players: [
        {
          ...registered.players[0],
          hand: { ...registered.players[0].hand, cardIds: [source.instanceId] },
          waitingRoom: {
            ...registered.players[0].waitingRoom,
            cardIds: [waitingMember.instanceId],
          },
        },
        registered.players[1],
      ],
    } satisfies GameState;

    const handle = build(state);
    expect(handle.contract).toMatchObject({
      kind: 'SPECIAL_MEMBER_PLAY',
      canConfirm: false,
      canCancel: true,
    });
    expect(
      validateAiDecisionSelection(handle, {
        kind: 'CONFIRM_SPECIAL_MEMBER_PLAY',
        candidateIds: [],
      })
    ).toMatchObject({ ok: false });
    const witness = getAiDecisionWitness(handle);
    expect(witness).toEqual({ kind: 'CANCEL_SPECIAL_MEMBER_PLAY' });
    const materialized = materializeAiDecisionCommand(handle, witness!, NOW);
    expect(materialized).toMatchObject({
      ok: true,
      command: {
        type: GameCommandType.CANCEL_SPECIAL_MEMBER_PLAY,
        pendingId: 'unpayable-special-pending',
      },
    });
    if (!materialized.ok) throw new Error(materialized.error);

    const session = createGameSession({ now: () => NOW });
    session.restoreRuntimeState({ authorityState: state, currentPublicSeq: 0 });
    expect(session.executeCommand(materialized.command).success).toBe(true);
    expect(session.state?.pendingSpecialMemberPlay).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toContain(source.instanceId);
  });

  it('uses the shared named-payment validator for special member play selections', () => {
    const source = createCardInstance(
      {
        ...createMemberData('LL-bp7-001-R+', 15),
        name: '国木田花丸&優木せつ菜&嵐千砂都',
      },
      PLAYER_ID,
      'named-special-source'
    );
    const payments = [
      createCardInstance(
        { ...createMemberData('PAY-HANAMARU-1'), name: '国木田花丸' },
        PLAYER_ID,
        'pay-hanamaru-1'
      ),
      createCardInstance(
        { ...createMemberData('PAY-HANAMARU-2'), name: '国木田花丸' },
        PLAYER_ID,
        'pay-hanamaru-2'
      ),
      createCardInstance(
        { ...createMemberData('PAY-SETSUNA'), name: '優木せつ菜' },
        PLAYER_ID,
        'pay-setsuna'
      ),
      createCardInstance(
        { ...createMemberData('PAY-CHISATO'), name: '嵐千砂都' },
        PLAYER_ID,
        'pay-chisato'
      ),
    ];
    const energies = Array.from({ length: 10 }, (_, index) =>
      createCardInstance(
        createEnergyData(`NAMED-SPECIAL-ENERGY-${index}`),
        PLAYER_ID,
        `named-special-energy-${index}`
      )
    );
    const registered = registerCards(
      createState({
        currentPhase: GamePhase.MAIN_PHASE,
        currentSubPhase: SubPhase.NONE,
      }),
      [source, ...payments, ...energies]
    );
    const state = {
      ...registered,
      pendingSpecialMemberPlay: {
        id: 'named-special-pending',
        playerId: PLAYER_ID,
        sourceCardId: source.instanceId,
        targetSlot: SlotPosition.CENTER,
        candidateCardIds: payments.map(({ instanceId }) => instanceId),
        mode: 'LL_BP7_001_SPECIAL_PLAY',
        printedCost: 15,
        specialPlayCost: 10,
      },
      players: [
        {
          ...registered.players[0],
          hand: {
            ...registered.players[0].hand,
            cardIds: [source.instanceId, ...payments.map(({ instanceId }) => instanceId)],
          },
          energyZone: {
            ...registered.players[0].energyZone,
            cardIds: energies.map(({ instanceId }) => instanceId),
            cardStates: new Map(
              energies.map(({ instanceId }) => [
                instanceId,
                { orientation: OrientationState.ACTIVE },
              ])
            ),
          },
        },
        registered.players[1],
      ],
    } satisfies GameState;

    const handle = build(state);
    expect(handle.contract).toMatchObject({
      kind: 'SPECIAL_MEMBER_PLAY',
      canConfirm: true,
      minSelections: 3,
      maxSelections: 3,
    });
    expect(
      validateAiDecisionSelection(handle, {
        kind: 'CONFIRM_SPECIAL_MEMBER_PLAY',
        candidateIds: ['candidate-1', 'candidate-2', 'candidate-3'],
      })
    ).toMatchObject({ ok: false });
    const validSelection = {
      kind: 'CONFIRM_SPECIAL_MEMBER_PLAY',
      candidateIds: ['candidate-1', 'candidate-3', 'candidate-4'],
    } as const;
    expect(validateAiDecisionSelection(handle, validSelection)).toEqual({ ok: true });
    const sampledSelection = sampleAiDecisionSelection(handle, () => 0.9);
    expect(sampledSelection).not.toBeNull();
    expect(validateAiDecisionSelection(handle, sampledSelection!)).toEqual({ ok: true });
    const materialized = materializeAiDecisionCommand(handle, validSelection, NOW);
    expect(materialized.ok).toBe(true);
    if (!materialized.ok) throw new Error(materialized.error);

    const session = createGameSession({ now: () => NOW });
    session.restoreRuntimeState({ authorityState: state, currentPublicSeq: 0 });
    expect(session.executeCommand(materialized.command).success).toBe(true);
    expect(session.state?.players[0].memberSlots.slots.CENTER).toBe(source.instanceId);
  });

  it('materializes an explicit double-relay plan from the shared cost calculator', () => {
    const incoming = createCardInstance(
      createMemberData('PL!SP-bp4-004-P', 10),
      PLAYER_ID,
      'double-relay-incoming'
    );
    const left = createCardInstance(
      createMemberData('AI-CONTRACT-LEFT', 5),
      PLAYER_ID,
      'double-relay-left'
    );
    const center = createCardInstance(
      createMemberData('AI-CONTRACT-CENTER', 5),
      PLAYER_ID,
      'double-relay-center'
    );
    const registered = registerCards(
      createState({
        currentPhase: GamePhase.MAIN_PHASE,
        currentSubPhase: SubPhase.NONE,
      }),
      [incoming, left, center]
    );
    const state = {
      ...registered,
      players: [
        {
          ...registered.players[0],
          hand: { ...registered.players[0].hand, cardIds: [incoming.instanceId] },
          memberSlots: {
            ...registered.players[0].memberSlots,
            slots: {
              ...registered.players[0].memberSlots.slots,
              [SlotPosition.LEFT]: left.instanceId,
              [SlotPosition.CENTER]: center.instanceId,
            },
            cardStates: new Map([
              [left.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
              [
                center.instanceId,
                { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP },
              ],
            ]),
          },
        },
        registered.players[1],
      ],
    } satisfies GameState;

    const handle = build(state);
    if (handle.contract.kind !== 'MAIN_PHASE') throw new Error('expected main phase contract');
    const action = handle.contract.actions.find(
      (candidate) =>
        candidate.kind === 'PLAY_MEMBER' &&
        candidate.relayMode === 'DOUBLE' &&
        candidate.targetSlot === SlotPosition.LEFT
    );
    expect(action).toMatchObject({
      relayReplacementSlots: [SlotPosition.LEFT, SlotPosition.CENTER],
      paymentPreview: {
        energyCost: 0,
        replacementCount: 2,
      },
    });
    const materialized = materializeAiDecisionCommand(
      handle,
      { kind: 'SELECT_MAIN_PHASE_ACTION', actionId: action!.actionId },
      NOW
    );
    expect(materialized.ok).toBe(true);
    if (!materialized.ok) throw new Error(materialized.error);

    const session = createGameSession({ now: () => NOW });
    session.restoreRuntimeState({ authorityState: state, currentPublicSeq: 0 });
    expect(session.executeCommand(materialized.command).success).toBe(true);
    expect(session.state?.players[0].memberSlots.slots.LEFT).toBe(incoming.instanceId);
    expect(session.state?.players[0].memberSlots.slots.CENTER).toBeNull();
  });

  it('offers every legal hand card for LIVE set and supports set, unset, and confirm actions', () => {
    const live = createCardInstance(createLiveData('AI-CONTRACT-LIVE'), PLAYER_ID, 'live-card');
    const member = createCardInstance(
      createMemberData('AI-CONTRACT-NOT-LIVE'),
      PLAYER_ID,
      'not-live-card'
    );
    const registered = registerCards(
      createState({
        currentPhase: GamePhase.LIVE_SET_PHASE,
        currentSubPhase: SubPhase.LIVE_SET_FIRST_PLAYER,
        waitingPlayerId: PLAYER_ID,
        liveSetCardIds: new Map(),
      }),
      [live, member]
    );
    const state = {
      ...registered,
      players: [
        {
          ...registered.players[0],
          hand: {
            ...registered.players[0].hand,
            cardIds: [live.instanceId, member.instanceId],
          },
        },
        registered.players[1],
      ],
    } satisfies GameState;

    const handle = build(state);
    expect(handle.contract.kind).toBe('LIVE_SET');
    expect(JSON.stringify(handle.contract)).not.toContain(live.instanceId);
    if (handle.contract.kind !== 'LIVE_SET') throw new Error('expected live set contract');
    expect(handle.contract.handCandidates).toHaveLength(2);
    expect(handle.contract.actions.map((action) => action.kind)).toEqual([
      'SET_LIVE',
      'SET_LIVE',
      'CONFIRM_LIVE_SET',
    ]);
    expect(
      handle.contract.actions
        .filter((action) => action.kind === 'SET_LIVE')
        .map((action) => action.isLiveCard)
    ).toEqual([true, false]);
    expect(getAiDecisionWitness(handle)).toMatchObject({
      kind: 'SELECT_LIVE_SET_ACTION',
      actionId: handle.contract.actions[2]!.actionId,
    });

    const memberSetAction = handle.contract.actions.filter(
      (action) => action.kind === 'SET_LIVE'
    )[1]!;
    const memberSetCommand = materializeAiDecisionCommand(
      handle,
      { kind: 'SELECT_LIVE_SET_ACTION', actionId: memberSetAction.actionId },
      NOW
    );
    expect(memberSetCommand.ok).toBe(true);
    if (!memberSetCommand.ok) throw new Error(memberSetCommand.error);
    const memberSession = createGameSession({ now: () => NOW });
    memberSession.restoreRuntimeState({ authorityState: state, currentPublicSeq: 0 });
    expect(memberSession.executeCommand(memberSetCommand.command).success).toBe(true);
    expect(memberSession.state?.players[0].liveZone.cardIds).toContain(member.instanceId);

    const session = createGameSession({ now: () => NOW });
    session.restoreRuntimeState({ authorityState: state, currentPublicSeq: 0 });
    const setAction = handle.contract.actions.find((action) => action.kind === 'SET_LIVE')!;
    const setCommand = materializeAiDecisionCommand(
      handle,
      { kind: 'SELECT_LIVE_SET_ACTION', actionId: setAction.actionId },
      NOW
    );
    expect(setCommand.ok).toBe(true);
    if (!setCommand.ok) throw new Error(setCommand.error);
    expect(session.executeCommand(setCommand.command).success).toBe(true);

    const afterSet = build(session.state!);
    expect(afterSet.contract.kind).toBe('LIVE_SET');
    if (afterSet.contract.kind !== 'LIVE_SET') throw new Error('expected live set contract');
    expect(afterSet.contract.actions.map((action) => action.kind)).toContain('UNSET_LIVE');
    const unsetAction = afterSet.contract.actions.find((action) => action.kind === 'UNSET_LIVE')!;
    const unsetCommand = materializeAiDecisionCommand(
      afterSet,
      { kind: 'SELECT_LIVE_SET_ACTION', actionId: unsetAction.actionId },
      NOW
    );
    expect(unsetCommand.ok).toBe(true);
    if (!unsetCommand.ok) throw new Error(unsetCommand.error);
    expect(session.executeCommand(unsetCommand.command).success).toBe(true);
    expect(session.state?.players[0].hand.cardIds).toContain(live.instanceId);
  });
});

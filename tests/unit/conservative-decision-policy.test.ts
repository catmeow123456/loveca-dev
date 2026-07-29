import { describe, expect, it } from 'vitest';
import type { AiDecisionContract } from '../../src/application/ai-decisions/decision-contract';
import {
  AI_CONSERVATIVE_POLICY_VERSION,
  selectConservativeDecision,
} from '../../src/server/ai-battle/conservative-decision-policy';
import { SlotPosition, SubPhase } from '../../src/shared/types/enums';

const BASE = {
  schemaVersion: 'ai-decision-contract/v1',
  commandAdapterVersion: 'ai-decision-command-adapter/v1',
  decisionId: 'decision-1',
  authorityRevision: 7,
  seat: 'FIRST',
  windowSignature: 'window-1',
  mandatory: true,
} as const;

function handle(contract: AiDecisionContract): AiDecisionContract {
  return contract;
}

describe('conservative decision policy', () => {
  it('never replaces cards during mulligan', () => {
    const result = selectConservativeDecision(
      handle({
        ...BASE,
        kind: 'MULLIGAN',
        candidates: [
          { candidateId: 'candidate-1', projectedIndex: 0 },
          { candidateId: 'candidate-2', projectedIndex: 1 },
        ],
        minSelections: 0,
        maxSelections: 2,
      })
    );

    expect(result).toEqual({
      ok: true,
      policyVersion: AI_CONSERVATIVE_POLICY_VERSION,
      selection: { kind: 'MULLIGAN', candidateIds: [] },
    });
  });

  it('plays the lowest payable member, then hand position, slot, and action ID', () => {
    const result = selectConservativeDecision(
      handle({
        ...BASE,
        kind: 'MAIN_PHASE',
        candidates: [
          { candidateId: 'candidate-a', projectedIndex: 2 },
          { candidateId: 'candidate-b', projectedIndex: 0 },
        ],
        actions: [
          {
            actionId: 'end',
            kind: 'END_MAIN_PHASE',
          },
          {
            actionId: 'play-a',
            kind: 'PLAY_MEMBER',
            sourceCandidateId: 'candidate-a',
            targetSlot: SlotPosition.LEFT,
            paymentPreview: {
              modifiedCost: 2,
              energyCost: 2,
              relayDiscount: 0,
              replacementCount: 0,
            },
          },
          {
            actionId: 'play-b-right',
            kind: 'PLAY_MEMBER',
            sourceCandidateId: 'candidate-b',
            targetSlot: SlotPosition.RIGHT,
            paymentPreview: {
              modifiedCost: 1,
              energyCost: 1,
              relayDiscount: 0,
              replacementCount: 0,
            },
          },
          {
            actionId: 'play-b-left',
            kind: 'PLAY_MEMBER',
            sourceCandidateId: 'candidate-b',
            targetSlot: SlotPosition.LEFT,
            paymentPreview: {
              modifiedCost: 1,
              energyCost: 1,
              relayDiscount: 0,
              replacementCount: 0,
            },
          },
          {
            actionId: 'ability',
            kind: 'ACTIVATE_ABILITY',
            sourceCandidateId: 'candidate-b',
          },
        ],
      })
    );

    expect(result).toMatchObject({
      ok: true,
      selection: { kind: 'SELECT_MAIN_PHASE_ACTION', actionId: 'play-b-left' },
    });
  });

  it('ends the main phase instead of activating an optional ability', () => {
    const result = selectConservativeDecision(
      handle({
        ...BASE,
        kind: 'MAIN_PHASE',
        candidates: [{ candidateId: 'candidate-a', projectedIndex: 0 }],
        actions: [
          {
            actionId: 'ability',
            kind: 'ACTIVATE_ABILITY',
            sourceCandidateId: 'candidate-a',
          },
          { actionId: 'end', kind: 'END_MAIN_PHASE' },
        ],
      })
    );

    expect(result).toMatchObject({
      ok: true,
      selection: { kind: 'SELECT_MAIN_PHASE_ACTION', actionId: 'end' },
    });
  });

  it('sets actual LIVE cards in projected hand order before confirming', () => {
    const result = selectConservativeDecision(
      handle({
        ...BASE,
        kind: 'LIVE_SET',
        handCandidates: [
          { candidateId: 'member', projectedIndex: 0 },
          { candidateId: 'live-late', projectedIndex: 3 },
          { candidateId: 'live-early', projectedIndex: 1 },
        ],
        liveZoneCandidates: [],
        actions: [
          {
            actionId: 'set-member',
            kind: 'SET_LIVE',
            candidateId: 'member',
            isLiveCard: false,
          },
          {
            actionId: 'set-live-late',
            kind: 'SET_LIVE',
            candidateId: 'live-late',
            isLiveCard: true,
          },
          {
            actionId: 'set-live-early',
            kind: 'SET_LIVE',
            candidateId: 'live-early',
            isLiveCard: true,
          },
          { actionId: 'confirm', kind: 'CONFIRM_LIVE_SET' },
        ],
        setCount: 0,
        setLimit: 3,
      })
    );

    expect(result).toMatchObject({
      ok: true,
      selection: {
        kind: 'SELECT_LIVE_SET_ACTION',
        actionId: 'set-live-early',
      },
    });
  });

  it('confirms an empty LIVE set rather than setting a non-LIVE card', () => {
    const result = selectConservativeDecision(
      handle({
        ...BASE,
        kind: 'LIVE_SET',
        handCandidates: [{ candidateId: 'member', projectedIndex: 0 }],
        liveZoneCandidates: [],
        actions: [
          {
            actionId: 'set-member',
            kind: 'SET_LIVE',
            candidateId: 'member',
            isLiveCard: false,
          },
          { actionId: 'confirm', kind: 'CONFIRM_LIVE_SET' },
        ],
        setCount: 0,
        setLimit: 3,
      })
    );

    expect(result).toMatchObject({
      ok: true,
      selection: { kind: 'SELECT_LIVE_SET_ACTION', actionId: 'confirm' },
    });
  });

  it('uses projected LIVE-zone order for success settlement', () => {
    const result = selectConservativeDecision(
      handle({
        ...BASE,
        kind: 'SUCCESS_LIVE_SELECTION',
        candidates: [
          { candidateId: 'candidate-late', projectedIndex: 2 },
          { candidateId: 'candidate-early', projectedIndex: 0 },
        ],
      })
    );

    expect(result).toMatchObject({
      ok: true,
      selection: {
        kind: 'SELECT_SUCCESS_LIVE',
        candidateId: 'candidate-early',
      },
    });
  });

  it('uses the contract witness for mandatory and optional effect inputs', () => {
    const mandatory = selectConservativeDecision(
      handle({
        ...BASE,
        kind: 'ACTIVE_EFFECT',
        effectRef: 'CURRENT',
        abilityId: 'ability-1',
        stepId: 'step-1',
        input: {
          kind: 'CARD_SELECTION',
          candidates: [{ candidateId: 'candidate-1', projectedIndex: 0 }],
          ordered: false,
          minSelections: 1,
          maxSelections: 1,
          canSkip: false,
          groups: [],
        },
      })
    );
    const optional = selectConservativeDecision(
      handle({
        ...BASE,
        mandatory: false,
        kind: 'ACTIVE_EFFECT',
        effectRef: 'CURRENT',
        abilityId: 'ability-2',
        stepId: 'step-2',
        input: {
          kind: 'OPTION_SELECTION',
          options: [{ optionId: 'option-1', label: '发动' }],
          minSelections: 0,
          maxSelections: 1,
          canSkip: true,
        },
      })
    );

    expect(mandatory).toMatchObject({
      ok: true,
      selection: {
        kind: 'SELECT_EFFECT_CARDS',
        candidateIds: ['candidate-1'],
      },
    });
    expect(optional).toMatchObject({
      ok: true,
      selection: { kind: 'SELECT_EFFECT_OPTIONS', optionIds: [] },
    });
  });

  it('confirms phase and cancels optional special member play', () => {
    const phase = selectConservativeDecision(
      handle({
        ...BASE,
        kind: 'PHASE_CONFIRMATION',
        subPhase: SubPhase.LIVE_SET_FIRST_PLAYER,
      })
    );
    const special = selectConservativeDecision(
      handle({
        ...BASE,
        mandatory: false,
        kind: 'SPECIAL_MEMBER_PLAY',
        mode: 'N_BP7_011_WAITING_MEMBERS_COST_MINUS_TWO',
        candidates: [],
        minSelections: 0,
        maxSelections: 1,
        canConfirm: false,
        canCancel: true,
        stepText: '特殊登场',
        confirmationLabel: '确认',
      })
    );

    expect(phase).toMatchObject({
      ok: true,
      selection: { kind: 'CONFIRM_PHASE' },
    });
    expect(special).toMatchObject({
      ok: true,
      selection: { kind: 'CANCEL_SPECIAL_MEMBER_PLAY' },
    });
  });
});

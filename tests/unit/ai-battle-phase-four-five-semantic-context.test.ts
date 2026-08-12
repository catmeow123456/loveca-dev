import { describe, expect, it } from 'vitest';
import {
  AI_OBSERVATION_SCHEMA_VERSION,
  type AiObservation,
} from '../../src/server/ai-battle/ai-observation';
import {
  AI_BATTLE_PHASE_FOUR_FIVE_BASELINE_VERSION,
  AI_BATTLE_PHASE_FOUR_FIVE_COMPONENT_STATUS,
  AI_BATTLE_PHASE_FOUR_FIVE_COMPONENT_VERSIONS,
  AI_BATTLE_PHASE_FOUR_FIVE_RUNTIME_BOUNDARY,
  AI_BATTLE_PHASE_FOUR_FIVE_STATUS,
} from '../../src/server/ai-battle/phase-four-five-baseline';
import {
  AI_SEMANTIC_DECISION_CONTEXT_SCHEMA_VERSION,
  buildAiSemanticDecisionContext,
  getRequiredAiSemanticFactIdsForSelection,
} from '../../src/server/ai-battle/semantic-context';

function relayObservation(): AiObservation {
  const emptyZone = (zoneKey: string, zoneType = zoneKey) => ({
    zoneKey,
    zoneType,
    count: 0,
    ordered: false,
    visibleCards: [],
  });
  const energyCards = Array.from({ length: 4 }, (_, index) => ({
    cardCode: `ENERGY-${String(index + 1)}`,
    name: '能量',
    cardType: 'ENERGY',
    orientation: 'ACTIVE',
  }));
  return {
    schemaVersion: AI_OBSERVATION_SCHEMA_VERSION,
    decisionContractSchemaVersion: 'ai-battle.decision-contract/v1',
    commandAdapterVersion: 'ai-battle.decision-command-adapter/v1',
    authorityRevision: 21,
    viewerSeat: 'FIRST',
    turn: {
      count: 3,
      phase: 'MAIN_PHASE',
      subPhase: 'FREE_ACTION',
      firstSeat: 'FIRST',
      activeSeat: 'FIRST',
      prioritySeat: 'FIRST',
    },
    window: null,
    liveResult: null,
    endInfo: null,
    seats: {
      FIRST: {
        successLiveCount: 0,
        successLiveScore: 0,
        zones: [
          emptyZone('MEMBER_LEFT', 'MEMBER_SLOT'),
          {
            zoneKey: 'MEMBER_CENTER',
            zoneType: 'MEMBER_SLOT',
            count: 1,
            ordered: false,
            visibleCards: [
              {
                cardCode: 'PL!HS-bp5-008-R',
                name: '桂城 泉',
                cardType: 'MEMBER',
                cost: 4,
                effectiveCost: 4,
                blade: 2,
                hearts: [{ color: 'GREEN', count: 2 }],
                text: '【登场】将此成员变为待机并弃 1 张手牌：检视卡组顶 5 张。',
                orientation: 'ACTIVE',
                role: 'PRIMARY',
                slot: 'CENTER',
              },
            ],
          },
          emptyZone('MEMBER_RIGHT', 'MEMBER_SLOT'),
          {
            zoneKey: 'HAND',
            zoneType: 'HAND',
            count: 1,
            ordered: false,
            visibleCards: [
              {
                cardCode: 'PL!HS-sd1-012-SD',
                name: '百生吟子',
                cardType: 'MEMBER',
                cost: 4,
              },
            ],
          },
          {
            zoneKey: 'ENERGY_ZONE',
            zoneType: 'ENERGY_ZONE',
            count: 4,
            ordered: true,
            visibleCards: energyCards,
          },
          emptyZone('MAIN_DECK'),
          emptyZone('ENERGY_DECK'),
          emptyZone('LIVE_ZONE'),
          emptyZone('WAITING_ROOM'),
          emptyZone('SUCCESS_ZONE'),
          emptyZone('EXILE_ZONE'),
        ],
      },
      SECOND: {
        successLiveCount: 0,
        successLiveScore: 0,
        zones: [
          emptyZone('MEMBER_LEFT', 'MEMBER_SLOT'),
          emptyZone('MEMBER_CENTER', 'MEMBER_SLOT'),
          emptyZone('MEMBER_RIGHT', 'MEMBER_SLOT'),
          emptyZone('HAND'),
          emptyZone('MAIN_DECK'),
          emptyZone('ENERGY_DECK'),
          emptyZone('ENERGY_ZONE'),
          emptyZone('LIVE_ZONE'),
          emptyZone('WAITING_ROOM'),
          emptyZone('SUCCESS_ZONE'),
          emptyZone('EXILE_ZONE'),
        ],
      },
    },
    sharedZones: [],
    decision: {
      decisionRef: 'current-decision',
      kind: 'MAIN_PHASE',
      mandatory: false,
      candidates: [
        {
          candidateId: 'candidate-ginko',
          hidden: false,
          card: {
            cardCode: 'PL!HS-sd1-012-SD',
            name: '百生吟子',
            cardType: 'MEMBER',
            cost: 4,
            blade: 1,
            hearts: [{ color: 'GREEN', count: 1 }],
            text: '-',
          },
        },
      ],
      options: [],
      actions: [
        {
          actionId: 'play-left-pay-four',
          kind: 'PLAY_MEMBER',
          candidateId: 'candidate-ginko',
          targetSlot: 'LEFT',
          paymentPreview: {
            modifiedCost: 4,
            energyCost: 4,
            relayDiscount: 0,
            replacementCount: 0,
          },
        },
        {
          actionId: 'relay-center-pay-zero',
          kind: 'PLAY_MEMBER',
          candidateId: 'candidate-ginko',
          targetSlot: 'CENTER',
          paymentPreview: {
            modifiedCost: 4,
            energyCost: 0,
            relayDiscount: 4,
            replacementCount: 1,
          },
        },
      ],
    },
  };
}

describe('AI battle Phase 4.5 semantic decision context', () => {
  it('truthfully marks the first semantic slice in progress', () => {
    expect(AI_BATTLE_PHASE_FOUR_FIVE_BASELINE_VERSION).toBe('ai-battle.phase-four-five/v5');
    expect(AI_BATTLE_PHASE_FOUR_FIVE_COMPONENT_VERSIONS.protocolManifestRevision).toBe(1);
    expect(AI_BATTLE_PHASE_FOUR_FIVE_STATUS).toBe('IN_PROGRESS');
    expect(AI_BATTLE_PHASE_FOUR_FIVE_COMPONENT_STATUS).toMatchObject({
      semanticCurrentState: 'IMPLEMENTED_FROM_REDACTED_OBSERVATION',
      completeDeckKnowledgeInSystemPrompt:
        'IMPLEMENTED_EXACT_COUNT_CARD_CODE_NAME_TEXT_COST_BLADE_HEART_AND_LIVE_REQUIREMENTS',
      modelStrategyDirectives: 'REMOVED_FROM_MODEL_PROMPT_RULES_AND_DECK_FACTS_ONLY',
      optionalTacticalChoices: 'IMPLEMENTED_MODEL_DECIDES_CONSERVATIVE_WITNESS_ONLY_FOR_FALLBACK',
      semanticFactReferences: 'IMPLEMENTED_SERVER_DERIVED_FROM_ACCEPTED_SELECTION',
      semanticConclusionConsistency: 'PENDING_BEYOND_SERVER_DERIVED_FACT_COVERAGE',
      administratorContextInspector: 'IMPLEMENTED_ADMIN_DEVELOPMENT_IN_MEMORY',
      broaderEffectSemanticRegressions:
        'IMPLEMENTED_SOURCE_COST_TARGET_HISTORY_FORMATION_GROUP_LIVE_SETTLEMENT_AND_STAGE_RESOURCE_SLICES',
      centralizedProtocolVersionManifest:
        'IMPLEMENTED_SHARED_SINGLE_SOURCE_WITH_COMPATIBILITY_AND_LITERAL_GOVERNANCE',
      realProviderSemanticEvaluation: 'PENDING',
    });
    expect(AI_BATTLE_PHASE_FOUR_FIVE_RUNTIME_BOUNDARY).toMatchObject({
      rawObservationSentToModel: false,
      rawSelectedHistorySentToModel: false,
      shuffledDeckOrderSentToModel: false,
      exactDeckCompositionSentAsSystemKnowledge: true,
      modelFreeTextStoredAsHistoryFact: false,
      authoritySelectionValidationStillRequired: true,
      serverStrategyValueVetoImplemented: false,
      administratorContextInspectorDevelopmentOnly: true,
      administratorContextInspectorAdminOnly: true,
      administratorContextInspectorPersisted: false,
    });
  });

  it('describes relay consequences and keeps card abilities attached to the actual source', () => {
    const context = buildAiSemanticDecisionContext({
      observation: relayObservation(),
      selectedHistory: [],
    });
    const relay = context.currentDecision.choices.find(
      (choice) => choice.referenceId === 'relay-center-pay-zero'
    );
    const normal = context.currentDecision.choices.find(
      (choice) => choice.referenceId === 'play-left-pay-four'
    );

    expect(context.schemaVersion).toBe(AI_SEMANTIC_DECISION_CONTEXT_SCHEMA_VERSION);
    expect(relay).toBeDefined();
    expect(relay?.facts.map((item) => item.factId)).toEqual([
      'decision.action.2.choice',
      'decision.action.2.source_boundary',
      'decision.action.2.consequence',
    ]);
    expect(relay?.facts.map((item) => item.text).join('\n')).toContain(
      'PL!HS-sd1-012-SD 费用 4，BLADE 1，HEART 绿×1「百生吟子」'
    );
    expect(relay?.facts.map((item) => item.text).join('\n')).toContain(
      '中央的PL!HS-bp5-008-R 费用 4，BLADE 2，HEART 绿×2「桂城 泉」'
    );
    expect(relay?.facts.map((item) => item.text).join('\n')).toContain(
      '左侧=空，中央=PL!HS-sd1-012-SD 费用 4，BLADE 1，HEART 绿×1「百生吟子」，右侧=空'
    );
    expect(relay?.facts.map((item) => item.text).join('\n')).toContain('活跃能量从 4 变为 4');
    expect(relay?.facts.map((item) => item.text).join('\n')).toContain(
      'BLADE 合计 2、HEART 绿×2变为成员 1 名、有效费用合计 4、BLADE 合计 1'
    );
    expect(relay?.facts.map((item) => item.text).join('\n')).toContain(
      '下回合可作为换手减免基础的成员为中央=4 费'
    );
    expect(relay?.facts.map((item) => item.text).join('\n')).toContain('当前公开卡文没有能力文本');
    expect(relay?.facts.map((item) => item.text).join('\n')).toContain(
      '不能把被换手成员的能力转给它'
    );
    expect(relay?.facts.map((item) => item.text).join('\n')).not.toContain('检视卡组顶');
    expect(context.currentState.facts.map((item) => item.text).join('\n')).toContain(
      '【登场】将此成员变为待机并弃 1 张手牌：检视卡组顶 5 张。'
    );

    expect(normal?.facts.map((item) => item.text).join('\n')).toContain(
      '左侧=PL!HS-sd1-012-SD 费用 4，BLADE 1，HEART 绿×1「百生吟子」，中央=PL!HS-bp5-008-R 费用 4，BLADE 2，HEART 绿×2「桂城 泉」，右侧=空'
    );
    expect(normal?.facts.map((item) => item.text).join('\n')).toContain('活跃能量从 4 变为 0');
  });

  it('plainly warns when an activated ability immediately spends the only stage member', () => {
    const observation = relayObservation();
    const kaho = {
      cardCode: 'PL!HS-PR-014-RM',
      name: '日野下花帆',
      cardType: 'MEMBER',
      cost: 2,
      text: '【起动】将此成员从舞台放置入休息室：从自己的休息室将1张成员卡加入手牌。',
      orientation: 'ACTIVE',
      role: 'PRIMARY' as const,
      slot: 'LEFT',
    };
    const context = buildAiSemanticDecisionContext({
      observation: {
        ...observation,
        seats: {
          ...observation.seats,
          FIRST: {
            ...observation.seats.FIRST,
            zones: observation.seats.FIRST.zones.map((zone) => {
              if (zone.zoneKey === 'MEMBER_LEFT') {
                return { ...zone, count: 1, visibleCards: [kaho] };
              }
              if (zone.zoneKey === 'MEMBER_CENTER') {
                return { ...zone, count: 0, visibleCards: [] };
              }
              return zone;
            }),
          },
        },
        decision: {
          decisionRef: 'current-decision',
          kind: 'MAIN_PHASE',
          mandatory: false,
          candidates: [
            {
              candidateId: 'candidate-kaho',
              hidden: false,
              card: kaho,
              location: {
                ownerSeat: 'FIRST',
                zoneKey: 'MEMBER_LEFT',
                slot: 'LEFT',
                role: 'PRIMARY',
              },
            },
          ],
          options: [],
          actions: [
            {
              actionId: 'activate-kaho',
              kind: 'ACTIVATE_ABILITY',
              candidateId: 'candidate-kaho',
              label: kaho.text,
            },
            { actionId: 'end-main', kind: 'END_MAIN_PHASE' },
          ],
        },
      },
      selectedHistory: [],
    });

    const action = context.currentDecision.choices.find(
      (choice) => choice.referenceId === 'activate-kaho'
    );
    const consequence = action?.facts.map((item) => item.text).join('\n');
    expect(context.currentDecision.instruction).toContain('场面强度变化');
    expect(
      context.currentState.facts.find((item) => item.factId === 'state.self.main_phase_goal')?.text
    ).toContain('当前 choices 是本窗口的完整合法动作');
    expect(consequence).toContain('会立即从我方左侧成员区进入我方休息室');
    expect(consequence).toContain('场上成员从 1 名变为 0 名');
    expect(consequence).toContain('我方舞台会变为空');
    expect(consequence).toContain('不是在手牌中检索');
    expect(consequence).toContain('只有下一步列出的卡才是合法目标');
    expect(consequence).not.toContain('后续费用、对象和步骤必须等待新的决定');
  });

  it('keeps hidden candidates anonymous in semantic model context', () => {
    const observation = relayObservation();
    const context = buildAiSemanticDecisionContext({
      observation: {
        ...observation,
        decision: {
          ...observation.decision,
          candidates: [{ candidateId: 'blind-1', hidden: true }],
          actions: [],
        },
      },
      selectedHistory: [],
    });

    const serialized = JSON.stringify(context);
    expect(serialized).toContain('身份尚未公开的卡');
    expect(serialized).not.toContain('secret-card-code');
    expect(serialized).not.toContain('secret-card-name');
  });

  it('binds an optional energy payment to the actual effect source and exposes not paying separately', () => {
    const observation = relayObservation();
    const sourceCard = {
      cardCode: 'PL!HS-sd1-006-SD',
      name: '安养寺姬芽',
      cardType: 'MEMBER',
      cost: 15,
      text: '【LIVE开始时】可以支付[E]：LIVE结束时为止，获得[BLADE][BLADE]。',
      orientation: 'ACTIVE',
      role: 'PRIMARY' as const,
      slot: 'CENTER',
    };
    const context = buildAiSemanticDecisionContext({
      observation: {
        ...observation,
        turn: {
          ...observation.turn,
          phase: 'PERFORMANCE_PHASE',
          subPhase: 'PERFORMANCE_LIVE_START_EFFECTS',
        },
        seats: {
          ...observation.seats,
          FIRST: {
            ...observation.seats.FIRST,
            zones: observation.seats.FIRST.zones.map((zone) =>
              zone.zoneKey === 'MEMBER_CENTER'
                ? { ...zone, count: 1, visibleCards: [sourceCard] }
                : zone
            ),
          },
        },
        decision: {
          decisionRef: 'current-decision',
          kind: 'ACTIVE_EFFECT',
          mandatory: false,
          candidates: [],
          options: [{ optionId: 'option-1', label: '支付[E]' }],
          actions: [],
          abilityId: 'PL!HS-sd1-006-SD:live-start-pay-energy-gain-blade',
          stepId: 'OPTIONAL_PAY_ENERGY',
          effectSource: {
            controllerSeat: 'FIRST',
            card: sourceCard,
            publicDisplayCardCode: sourceCard.cardCode,
            location: {
              ownerSeat: 'FIRST',
              zoneKey: 'MEMBER_CENTER',
              slot: 'CENTER',
              role: 'PRIMARY',
            },
          },
          effectText: sourceCard.text,
          stepText: '可以支付[E]发动此效果。',
          input: {
            kind: 'OPTION_SELECTION',
            minSelections: 0,
            maxSelections: 1,
            canSkip: true,
          },
        },
      },
      selectedHistory: [],
    });

    expect(
      context.currentDecision.facts.find((item) => item.factId === 'decision.source')?.text
    ).toContain('PL!HS-sd1-006-SD 费用 15「安养寺姬芽」');
    expect(
      context.currentDecision.facts.find((item) => item.factId === 'decision.source')?.text
    ).toContain('现在位于我方中央成员区');
    const pay = context.currentDecision.choices.find(
      (choice) => choice.referenceType === 'OPTION' && choice.referenceId === 'option-1'
    );
    const skip = context.currentDecision.choices.find(
      (choice) => choice.referenceId === 'SKIP_EFFECT_OPTIONS'
    );
    expect(pay?.facts.map((item) => item.text).join('\n')).toContain(
      '为PL!HS-sd1-006-SD 费用 15「安养寺姬芽」执行「支付[E]」'
    );
    expect(skip?.facts.map((item) => item.text).join('\n')).toContain('不会支付这个选项写明的费用');

    expect(
      getRequiredAiSemanticFactIdsForSelection(context, {
        kind: 'SELECT_EFFECT_OPTIONS',
        optionIds: ['option-1'],
      })
    ).toEqual(
      expect.arrayContaining([
        'decision.base',
        'decision.source',
        'decision.effect',
        'decision.constraints',
        'decision.option.1.meaning',
        'decision.option.1.consequence',
      ])
    );
    expect(
      getRequiredAiSemanticFactIdsForSelection(context, {
        kind: 'SELECT_EFFECT_OPTIONS',
        optionIds: [],
      })
    ).toContain('decision.selection.skip_effect_options.consequence');
  });

  it('states the visible target location and keeps target effects owned by the source ability', () => {
    const observation = relayObservation();
    const sourceCard = {
      cardCode: 'PL!-sd1-002-SD',
      name: '绚濑绘里',
      cardType: 'MEMBER',
      cost: 2,
      text: '【起动】将此成员从舞台放置入休息室：从自己的休息室将1张成员卡加入手牌。',
    };
    const targetCard = {
      cardCode: 'PL!-sd1-004-SD',
      name: '园田海未',
      cardType: 'MEMBER',
      cost: 11,
      text: '【登场】检视自己卡组顶5张。',
    };
    const context = buildAiSemanticDecisionContext({
      observation: {
        ...observation,
        decision: {
          decisionRef: 'current-decision',
          kind: 'ACTIVE_EFFECT',
          mandatory: true,
          candidates: [
            {
              candidateId: 'candidate-1',
              hidden: false,
              card: targetCard,
              location: { ownerSeat: 'FIRST', zoneKey: 'WAITING_ROOM' },
            },
          ],
          options: [],
          actions: [],
          abilityId: 'PL!-sd1-002-SD:activated-send-self-to-waiting-room-add-member',
          stepId: 'SELECT_MEMBER',
          effectSource: {
            controllerSeat: 'FIRST',
            card: sourceCard,
            publicDisplayCardCode: sourceCard.cardCode,
            location: { ownerSeat: 'FIRST', zoneKey: 'WAITING_ROOM' },
          },
          effectText: sourceCard.text,
          stepText: '请选择自己休息室中1张成员卡加入手牌。',
          input: {
            kind: 'CARD_SELECTION',
            minSelections: 1,
            maxSelections: 1,
            canSkip: false,
            ordered: false,
            groups: [],
          },
        },
      },
      selectedHistory: [],
    });
    const candidate = context.currentDecision.choices.find(
      (choice) => choice.referenceId === 'candidate-1'
    );

    expect(
      context.currentDecision.facts.find((item) => item.factId === 'decision.source')?.text
    ).toContain('现在位于我方休息室');
    expect(candidate?.title).toContain('PL!-sd1-004-SD 费用 11「园田海未」');
    expect(candidate?.title).toContain('当前位于我方休息室');
    expect(candidate?.facts.map((item) => item.text).join('\n')).toContain(
      '让PL!-sd1-002-SD 费用 2「绚濑绘里」的当前效果处理这张卡'
    );
    expect(candidate?.facts.map((item) => item.text).join('\n')).not.toContain(
      '检视自己卡组顶5张属于PL!-sd1-002-SD'
    );
  });

  it('binds every stage member to its destination and carries attached cards with that member', () => {
    const observation = relayObservation();
    const shiki = {
      cardCode: 'PL!SP-bp4-008-P',
      name: '若菜四季',
      cardType: 'MEMBER',
      cost: 13,
      text: '【LIVE开始时】可以进行站位变换。',
      orientation: 'ACTIVE',
      role: 'PRIMARY' as const,
      slot: 'LEFT',
    };
    const ginko = {
      cardCode: 'PL!HS-sd1-012-SD',
      name: '百生吟子',
      cardType: 'MEMBER',
      cost: 4,
      text: '-',
      orientation: 'WAITING',
      role: 'PRIMARY' as const,
      slot: 'CENTER',
    };
    const context = buildAiSemanticDecisionContext({
      observation: {
        ...observation,
        seats: {
          ...observation.seats,
          FIRST: {
            ...observation.seats.FIRST,
            zones: observation.seats.FIRST.zones.map((zone) => {
              if (zone.zoneKey === 'MEMBER_LEFT') {
                return {
                  ...zone,
                  count: 3,
                  visibleCards: [
                    shiki,
                    {
                      cardCode: 'ENERGY-ATTACHED',
                      name: '能量',
                      cardType: 'ENERGY',
                      orientation: 'ACTIVE',
                      role: 'ENERGY_BELOW' as const,
                      slot: 'LEFT',
                    },
                    {
                      cardCode: 'PL!HS-sd1-013-SD',
                      name: '徒町小铃',
                      cardType: 'MEMBER',
                      cost: 6,
                      role: 'MEMBER_BELOW' as const,
                      slot: 'LEFT',
                    },
                  ],
                };
              }
              if (zone.zoneKey === 'MEMBER_CENTER') {
                return { ...zone, count: 1, visibleCards: [ginko] };
              }
              return zone;
            }),
          },
        },
        decision: {
          decisionRef: 'current-decision',
          kind: 'ACTIVE_EFFECT',
          mandatory: false,
          candidates: [
            {
              candidateId: 'candidate-shiki',
              hidden: false,
              card: shiki,
              location: {
                ownerSeat: 'FIRST',
                zoneKey: 'MEMBER_LEFT',
                slot: 'LEFT',
                role: 'PRIMARY',
              },
            },
            {
              candidateId: 'candidate-ginko',
              hidden: false,
              card: ginko,
              location: {
                ownerSeat: 'FIRST',
                zoneKey: 'MEMBER_CENTER',
                slot: 'CENTER',
                role: 'PRIMARY',
              },
            },
          ],
          options: [],
          actions: [],
          abilityId: 'PL!SP-bp4-008-P:live-start-stage-formation',
          stepId: 'STAGE_FORMATION',
          effectSource: {
            controllerSeat: 'FIRST',
            card: shiki,
            publicDisplayCardCode: shiki.cardCode,
            location: {
              ownerSeat: 'FIRST',
              zoneKey: 'MEMBER_LEFT',
              slot: 'LEFT',
              role: 'PRIMARY',
            },
          },
          effectText: shiki.text,
          stepText: '可以进行站位变换。',
          input: {
            kind: 'STAGE_FORMATION',
            members: [
              { candidateId: 'candidate-shiki', originalSlot: 'LEFT' },
              { candidateId: 'candidate-ginko', originalSlot: 'CENTER' },
            ],
            slots: ['LEFT', 'CENTER', 'RIGHT'],
            canSkip: true,
          },
        },
      },
      selectedHistory: [],
    });

    const shikiToRight = context.currentDecision.choices.find(
      (choice) =>
        choice.referenceType === 'PLACEMENT' && choice.referenceId === 'candidate-shiki@RIGHT'
    );
    expect(shikiToRight?.title).toContain('PL!SP-bp4-008-P 费用 13「若菜四季」：左侧→右侧');
    expect(shikiToRight?.facts.map((item) => item.text).join('\n')).toContain(
      '其下方 1 张能量与 1 张成员卡也会跟着移动'
    );
    expect(
      context.currentDecision.facts.find((item) => item.factId === 'decision.constraints')?.text
    ).toContain('每名成员必须恰好出现一次，目标成员区不能重复');

    expect(
      getRequiredAiSemanticFactIdsForSelection(context, {
        kind: 'SET_STAGE_FORMATION',
        placements: [
          { candidateId: 'candidate-shiki', toSlot: 'RIGHT' },
          { candidateId: 'candidate-ginko', toSlot: 'LEFT' },
        ],
      })
    ).toEqual(
      expect.arrayContaining([
        'decision.placement.1.right.meaning',
        'decision.placement.1.right.consequence',
        'decision.placement.2.left.meaning',
        'decision.placement.2.left.consequence',
      ])
    );
    expect(getRequiredAiSemanticFactIdsForSelection(context, { kind: 'CONFIRM_EFFECT' })).toContain(
      'decision.selection.skip_stage_formation.consequence'
    );
  });

  it('organizes composite card selection as one submission with global and per-group limits', () => {
    const observation = relayObservation();
    const context = buildAiSemanticDecisionContext({
      observation: {
        ...observation,
        decision: {
          decisionRef: 'current-decision',
          kind: 'ACTIVE_EFFECT',
          mandatory: true,
          candidates: [
            {
              candidateId: 'candidate-a',
              hidden: false,
              card: {
                cardCode: 'PL!-sd1-002-SD',
                name: '绚濑绘里',
                cardType: 'MEMBER',
                cost: 2,
              },
              location: { ownerSeat: 'FIRST', zoneKey: 'WAITING_ROOM' },
            },
            {
              candidateId: 'candidate-b',
              hidden: false,
              card: {
                cardCode: 'PL!-sd1-004-SD',
                name: '园田海未',
                cardType: 'MEMBER',
                cost: 11,
              },
              location: { ownerSeat: 'FIRST', zoneKey: 'WAITING_ROOM' },
            },
            { candidateId: 'candidate-c', hidden: true },
          ],
          options: [],
          actions: [],
          stepId: 'COMPOSITE_GROUP_SELECTION',
          effectText: '从两个分组中各选择指定数量的卡牌。',
          stepText: '请选择合计2张卡牌。',
          input: {
            kind: 'CARD_SELECTION',
            minSelections: 2,
            maxSelections: 2,
            canSkip: false,
            ordered: false,
            groups: [
              {
                groupId: 'group-1',
                candidateIds: ['candidate-a', 'candidate-b'],
                minCount: 1,
                maxCount: 1,
              },
              {
                groupId: 'group-2',
                candidateIds: ['candidate-b', 'candidate-c'],
                minCount: 1,
                maxCount: 1,
              },
            ],
          },
        },
      },
      selectedHistory: [],
    });

    const constraintText = context.currentDecision.facts.map((item) => item.text).join('\n');
    expect(constraintText).toContain('一次选完并同时满足总数和每组数量，不能分几次选择');
    expect(constraintText).toContain('一张卡如果同时出现在多组，会同时计入这些组');
    expect(context.currentDecision.requiredFactIds).toEqual(
      expect.arrayContaining(['decision.group.1.constraint', 'decision.group.2.constraint'])
    );
    const overlap = context.currentDecision.choices.find(
      (choice) => choice.referenceId === 'candidate-b'
    );
    expect(overlap?.facts.map((item) => item.text).join('\n')).toContain(
      '同时计入group-1 的 1～1 项限制、group-2 的 1～1 项限制'
    );
    const hidden = context.currentDecision.choices.find(
      (choice) => choice.referenceId === 'candidate-c'
    );
    expect(hidden?.title).toContain('身份尚未公开的卡');
    expect(
      getRequiredAiSemanticFactIdsForSelection(context, {
        kind: 'SELECT_EFFECT_CARDS',
        candidateIds: ['candidate-a', 'candidate-c'],
      })
    ).toEqual(
      expect.arrayContaining([
        'decision.group.1.constraint',
        'decision.group.2.constraint',
        'decision.candidate.1.role',
        'decision.candidate.3.role',
      ])
    );
  });

  it('explains projected LIVE modifiers, confirmation, and successful-card settlement', () => {
    const observation = relayObservation();
    const startDash = {
      cardCode: 'PL!-sd1-019-SD',
      name: 'START:DASH!!',
      cardType: 'LIVE',
      score: 1,
      text: '【LIVE成功时】检视自己卡组顶的3张卡。',
      judgmentResult: true,
      liveScoreDelta: 1,
      requirementDeltas: [{ color: 'PINK', countDelta: -1 }],
    };
    const ending = {
      cardCode: 'PL!-sd1-020-SD',
      name: '终将听到青春的声音',
      cardType: 'LIVE',
      score: 2,
      judgmentResult: true,
      liveScoreDelta: 0,
    };
    const withLiveState: AiObservation = {
      ...observation,
      turn: {
        ...observation.turn,
        phase: 'LIVE_RESULT_PHASE',
        subPhase: 'RESULT_SETTLEMENT',
      },
      liveResult: {
        scores: { FIRST: 3, SECOND: 2 },
        scoreModifiers: { FIRST: 1, SECOND: -1 },
        winnerSeats: ['FIRST'],
        confirmedSeats: ['SECOND'],
      },
      seats: {
        ...observation.seats,
        FIRST: {
          ...observation.seats.FIRST,
          zones: observation.seats.FIRST.zones.map((zone) =>
            zone.zoneKey === 'LIVE_ZONE'
              ? { ...zone, count: 2, visibleCards: [startDash, ending] }
              : zone
          ),
        },
      },
      decision: {
        decisionRef: 'current-decision',
        kind: 'SUCCESS_LIVE_SELECTION',
        mandatory: true,
        candidates: [
          {
            candidateId: 'candidate-start-dash',
            hidden: false,
            card: startDash,
            location: { ownerSeat: 'FIRST', zoneKey: 'LIVE_ZONE' },
          },
          {
            candidateId: 'candidate-ending',
            hidden: false,
            card: ending,
            location: { ownerSeat: 'FIRST', zoneKey: 'LIVE_ZONE' },
          },
        ],
        options: [],
        actions: [],
      },
    };
    const context = buildAiSemanticDecisionContext({
      observation: withLiveState,
      selectedHistory: [],
    });

    expect(
      context.currentState.facts.find((item) => item.factId === 'state.live_result')?.text
    ).toContain('我方 3（分数修正 +1），对方 2（分数修正 -1）');
    expect(
      context.currentState.facts.find((item) => item.factId === 'state.live_result')?.text
    ).toContain('已经确认分数：对方');
    const candidate = context.currentDecision.choices.find(
      (choice) => choice.referenceId === 'candidate-start-dash'
    );
    const candidateFacts = candidate?.facts.map((item) => item.text).join('\n');
    expect(candidate?.title).toContain('PL!-sd1-019-SD 分数 1「START:DASH!!」');
    expect(candidateFacts).toContain('当前判定成功');
    expect(candidateFacts).toContain('卡牌级分数修正 +1');
    expect(candidateFacts).toContain('必要 HEART 修正 PINK -1');
    expect(candidateFacts).toContain('从我方 LIVE 区放入成功 LIVE 区');
    expect(candidateFacts).toContain('本轮其余 LIVE 不会一起成功');
    expect(
      getRequiredAiSemanticFactIdsForSelection(context, {
        kind: 'SELECT_SUCCESS_LIVE',
        candidateId: 'candidate-start-dash',
      })
    ).toEqual(
      expect.arrayContaining(['decision.candidate.1.live_result', 'decision.candidate.1.role'])
    );

    const judgment = buildAiSemanticDecisionContext({
      observation: {
        ...withLiveState,
        decision: {
          decisionRef: 'current-decision',
          kind: 'JUDGMENT_CONFIRMATION',
          mandatory: true,
          candidates: [],
          options: [],
          actions: [],
        },
      },
      selectedHistory: [],
    });
    const confirm = judgment.currentDecision.choices.find(
      (choice) => choice.referenceId === 'CONFIRM_JUDGMENT'
    );
    expect(confirm?.facts.map((item) => item.text).join('\n')).toContain(
      '规则模式只确认当前自动判定，不修改逐卡结果'
    );
    expect(confirm?.facts.map((item) => item.text).join('\n')).toContain(
      'PL!-sd1-019-SD 分数 1「START:DASH!!」'
    );
  });

  it('organizes accepted actions and visible deltas as lower-priority seat-relative history', () => {
    const context = buildAiSemanticDecisionContext({
      observation: relayObservation(),
      selectedHistory: [
        {
          schemaVersion: 'ai-battle.selected-history/v4',
          historyId: 'history-1',
          authorityRevision: 19,
          turnCount: 2,
          source: 'AUTHORITY_ACCEPTED_SELECTION',
          actorSeat: 'FIRST',
          category: 'MEMBER_PLAY',
          reasonCode: 'ACCEPTED_MEMBER_PLAY',
          summary:
            '权威已接受成员登场：PL!HS-sd1-012-SD 费用 4「百生吟子」登场到左侧；支付 4 张能量，不进行换手替换。',
          cards: [
            {
              cardCode: 'PL!HS-sd1-012-SD',
              name: '百生吟子',
              cardType: 'MEMBER',
              cost: 4,
            },
          ],
        },
        {
          schemaVersion: 'ai-battle.selected-history/v4',
          historyId: 'history-2',
          authorityRevision: 20,
          turnCount: 2,
          source: 'VISIBLE_PROJECTION_DELTA',
          affectedSeat: 'SECOND',
          category: 'VISIBLE_STATE_CHANGE',
          reasonCode: 'VISIBLE_WAITING_ROOM_ADDITION',
          summary: "A card is newly visible in the opponent's waiting room.",
          cards: [
            {
              cardCode: 'PL!-sd1-002-SD',
              name: '绚濑绘里',
              cardType: 'MEMBER',
              cost: 2,
            },
          ],
        },
      ],
    });

    expect(
      context.currentState.facts.find((item) => item.factId === 'state.freshness')?.text
    ).toContain('先看当前局面，再参考历史');
    expect(context.battleHistory[0]).toMatchObject({
      source: 'AUTHORITY_ACCEPTED_SELECTION',
      category: 'MEMBER_PLAY',
      subject: 'SELF',
    });
    expect(context.battleHistory[1]).toMatchObject({
      source: 'VISIBLE_PROJECTION_DELTA',
      category: 'VISIBLE_STATE_CHANGE',
      subject: 'OPPONENT',
    });
    const visibleFacts = context.battleHistory[1]?.facts.map((item) => item.text).join('\n');
    expect(visibleFacts).toContain('对方休息室新看到 1 张卡');
    expect(visibleFacts).toContain('不知道它们为什么移动');
    expect(visibleFacts).not.toContain('A card is newly visible');
  });
});

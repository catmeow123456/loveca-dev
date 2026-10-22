import { createRoot } from 'react-dom/client';
import { ProductFrame } from '@/components/common/ProductFrame';
import { GameBoard } from '@/components/game/GameBoard';
import { PresentationRoot } from '@/components/excel/PresentationRoot';
import { applyDocumentPresentation, installPresentationShortcut } from '@/lib/appPresentation';
import { useGameStore } from '@/store/gameStore';
import { prepareRecoveryScenario } from '../../../tests/helpers/recovery-animation-fixture';
import { prepareGinkoScenario } from '../../../tests/helpers/ginko-entrance-fixture';
import { prepareCheer } from '../recovery-review/cheerFixture';
import type { ActiveEffectViewState, ViewZoneKey, ViewZoneState } from '@game/online/types';
import type { AnyCardData } from '@game/domain/entities/card';
import { GameCommandType } from '@game/application/game-commands';
import {
  GamePhase,
  HeartColor,
  OrientationState,
  SlotPosition,
  SubPhase,
} from '@game/shared/types/enums';
import '@/index.css';
applyDocumentPresentation();
installPresentationShortcut();
const store = () => useGameStore.getState();
const realConfirm = store().confirmEffectStep;
const realChoice = store().confirmEffectChoice;
const realEntranceAck = store().acknowledgeCardEntrance;
const submissions: unknown[][] = [];
function recovery(multiple = false) {
  useGameStore.setState({ confirmEffectStep: realConfirm, confirmEffectChoice: realChoice });
  const fixture = prepareRecoveryScenario(multiple ? 'multiple' : 'single', store().gameSession);
  store().loadCardData(fixture.cardData);
  useGameStore.setState({ viewingPlayerId: 'p1', replaySession: null, remoteSession: null });
  store().syncState();
  return fixture;
}
function handDetails() {
  const fixture = recovery();
  const view = store().playerViewState!;
  // The rule fixture uses generic cardText; this display contract supplies localized fronts.
  const effect = fixture.cards.find((card) => card.instanceId === 'hand-0')!.data.cardText;
  const objects = { ...view.objects };
  for (const id of view.table.zones.FIRST_HAND?.objectIds ?? []) {
    const object = objects[id];
    objects[id] = {
      ...object,
      frontInfo: {
        ...object.frontInfo!,
        cardTextCn: id === 'obj_hand-1' ? undefined : effect,
        cardTextJp: '【起動】手札を1枚控え室に置く。',
      },
    };
  }
  useGameStore.setState({ playerViewState: { ...view, objects } });
}
function selection(kind: string) {
  recovery();
  submissions.length = 0;
  const base: ActiveEffectViewState = {
    id: 'fixture-effect',
    abilityId: 'fixture-ability',
    sourceObjectId: 'obj_source',
    controllerSeat: 'FIRST',
    waitingSeat: 'FIRST',
    effectText: '固定投影交互契约：完整效果文本。',
    stepId: kind,
    stepText: '选择并确认',
  };
  const candidates = ['obj_hand-0', 'obj_hand-1', 'obj_hand-2'];
  const details: Partial<ActiveEffectViewState> =
    kind === 'numeric'
      ? {
          numericInput: {
            min: 1,
            max: 3,
            integerOnly: true,
            label: '支付数量',
            confirmLabel: '确认数量',
          },
        }
      : kind === 'slot'
        ? { selectableSlots: ['LEFT', 'CENTER', 'RIGHT'] }
        : kind === 'choice'
          ? {
              effectChoice: {
                mode: 'MULTI',
                minSelections: 1,
                maxSelections: 2,
                publicConfirmation: true,
                options: [
                  { id: 'first', text: '选择第一项完整效果', selectable: true },
                  { id: 'second', text: '选择第二项完整效果', selectable: true },
                  { id: 'illegal', text: '不可用的效果', selectable: false },
                ],
              },
            }
          : kind === 'blind'
            ? {
                selectableObjectIds: ['blind-token-1', 'blind-token-2'],
                selectableObjectsFaceDown: true,
              }
            : {
                selectableObjectIds: candidates,
                selectableObjectMode: kind === 'single' ? 'SINGLE' : 'ORDERED_MULTI',
                minSelectableObjects: 1,
                maxSelectableObjects: 2,
                canSkipSelection: true,
              };
  const view = store().playerViewState!;
  useGameStore.setState({
    playerViewState: {
      ...view,
      activeEffect: { ...base, ...details },
      permissions: {
        availableCommands: [{ command: GameCommandType.CONFIRM_EFFECT_STEP, enabled: true }],
      },
    },
    confirmEffectStep: (...args) => {
      submissions.push(args);
      return { success: true };
    },
    confirmEffectChoice: (...args) => {
      submissions.push(args);
      return { success: true };
    },
  });
}
function stageDetails() {
  selection('ordered');
  const prefix = '18680b81-f281-41a8-9a9f-5102244e030c:FIRST:b0e655df-d7fc-498f-943c-0a3dba4dd06a-';
  const objectId = (id: string) => `obj_${prefix}${id.replace(/^obj_/, '')}`;
  const effect =
    '【起动】[1回合1次][E][E]将1张手牌放置入休息室：从自己的休息室将1张『虹咲』的LIVE卡加入手牌。\n完整卡文最后一句。';
  const view = store().playerViewState!;
  store().loadCardData([{ ...store().getCardData('PL!N-bp5-014-N')!, cardTextCn: effect }]);
  const objects = Object.fromEntries(
    Object.entries(view.objects).map(([id, object]) => [
      objectId(id),
      {
        ...object,
        publicObjectId: objectId(id),
        frontInfo: object.frontInfo
          ? {
              ...object.frontInfo,
              cardTextCn: effect,
              ...(id === 'obj_source'
                ? {
                    modifierDelta: { costDelta: 2 },
                    blade: 3,
                    hearts: [{ color: HeartColor.YELLOW, count: 2 }],
                  }
                : {}),
              ...(id === 'obj_hand-1'
                ? {
                    cardCode: 'EXCEL-JP-TEXT',
                    nameCn: undefined,
                    nameJp: '日文候选',
                    cardTextCn: undefined,
                    cardTextJp: '【起動】手札を1枚控え室に置く。',
                  }
                : {}),
            }
          : undefined,
      },
    ])
  );
  objects[objectId('secret')] = {
    ...objects[objectId('source')],
    publicObjectId: objectId('secret'),
    ownerSeat: 'SECOND',
    controllerSeat: 'SECOND',
    surface: 'BACK',
    frontInfo: {
      ...objects[objectId('source')].frontInfo!,
      nameCn: '未公开成员',
      cardTextCn: '未公开效果',
    },
  };
  const zones = Object.fromEntries(
    Object.entries(view.table.zones).map(([key, zone]) => [
      key,
      {
        ...zone,
        objectIds: zone.objectIds?.map(objectId),
        slotMap:
          zone.slotMap &&
          Object.fromEntries(
            Object.entries(zone.slotMap).map(([slot, id]) => [slot, id ? objectId(id) : null])
          ),
        overlays:
          zone.overlays &&
          Object.fromEntries(
            Object.entries(zone.overlays).map(([slot, ids]) => [slot, ids.map(objectId)])
          ),
        memberBelow:
          zone.memberBelow &&
          Object.fromEntries(
            Object.entries(zone.memberBelow).map(([slot, ids]) => [slot, ids.map(objectId)])
          ),
      },
    ])
  ) as Record<ViewZoneKey, ViewZoneState>;
  for (const seat of ['FIRST', 'SECOND'] as const) {
    for (const slot of ['LEFT', 'RIGHT'] as const) {
      const key: ViewZoneKey = `${seat}_MEMBER_${slot}`;
      const id = objectId(`${seat}-${slot}`);
      objects[id] = {
        ...objects[objectId('source')],
        publicObjectId: id,
        ownerSeat: seat,
        controllerSeat: seat,
      };
      zones[key] = { ...zones[key], count: 1, slotMap: { [slot]: id } };
    }
  }
  useGameStore.setState({
    playerViewState: {
      ...view,
      objects,
      table: {
        zones: {
          ...zones,
          SECOND_MEMBER_CENTER: {
            ...zones.SECOND_MEMBER_CENTER,
            count: 1,
            slotMap: { CENTER: objectId('secret') },
          },
        },
      },
      activeEffect: {
        ...view.activeEffect!,
        sourceObjectId: objectId('source'),
        selectableObjectIds: ['hand-0', 'hand-1', 'hand-2'].map(objectId),
      },
    },
  });
  return { prefix, first: `${prefix}hand-0`, second: `${prefix}hand-1`, effect };
}
function compactHand() {
  const fixture = stageDetails();
  const view = store().playerViewState!;
  const objects = { ...view.objects };
  const member = objects[`obj_${fixture.first}`];
  const live = Object.values(objects).find((object) => object.frontInfo?.cardType === 'LIVE')!;
  const ids = [...view.table.zones.FIRST_HAND!.objectIds!];
  for (let index = ids.length; index < 16; index++) {
    const id = `obj_${fixture.prefix}hand-${index}`;
    const source = index % 2 === 0 ? live : member;
    ids.push(id);
    objects[id] = { ...source, publicObjectId: id };
  }
  const longId = ids[3];
  objects[longId] = {
    ...objects[longId],
    frontInfo: {
      ...objects[longId].frontInfo!,
      nameCn: '用于确认长名称不会撑高手牌行的完整卡牌名称',
      nameJp: 'This secondary name should not appear in the hand list',
    },
  };
  useGameStore.setState({
    playerViewState: {
      ...view,
      objects,
      table: {
        zones: {
          ...view.table.zones,
          FIRST_HAND: {
            ...view.table.zones.FIRST_HAND!,
            count: ids.length,
            objectIds: ids,
          },
        },
      },
    },
  });
  return { ...fixture, ids };
}

function compactZones() {
  const fixture = compactHand();
  const view = store().playerViewState!;
  const objects = { ...view.objects };
  const zones = { ...view.table.zones };
  const copy = (sourceId: string, suffix: string, hidden = false) => {
    const id = `obj_${fixture.prefix}zone-${suffix}`;
    objects[id] = {
      ...objects[sourceId],
      publicObjectId: id,
      surface: hidden ? 'BACK' : 'FRONT',
      ...(hidden
        ? {
            frontInfo: {
              ...objects[sourceId].frontInfo!,
              nameCn: '未公开区域卡牌',
              cardTextCn: '未公开区域卡效',
            },
          }
        : {}),
    };
    return id;
  };
  const waitingIds = fixture.ids.map((sourceId, index) => copy(sourceId, `waiting-${index}`));
  waitingIds.push(copy(fixture.ids[0], 'waiting-hidden', true));
  zones.FIRST_WAITING_ROOM = {
    ...zones.FIRST_WAITING_ROOM!,
    count: waitingIds.length,
    objectIds: waitingIds,
  };
  for (const zone of [
    'ENERGY_DECK',
    'MAIN_DECK',
    'SUCCESS_ZONE',
    'EXILE_ZONE',
    'INSPECTION_ZONE',
    'RESOLUTION_ZONE',
  ] as const) {
    const key = `FIRST_${zone}` as ViewZoneKey;
    const ids = [copy(fixture.ids[6], zone), copy(fixture.ids[0], `${zone}-hidden`, true)];
    zones[key] = { zone, ownerSeat: 'FIRST', count: 2, ordered: true, objectIds: ids };
  }
  zones.FIRST_MEMBER_CENTER = {
    ...zones.FIRST_MEMBER_CENTER!,
    overlays: { CENTER: [copy(fixture.ids[0], 'below')] },
    memberBelow: { CENTER: [copy(fixture.ids[0], 'below-hidden', true)] },
  };
  useGameStore.setState({ playerViewState: { ...view, objects, table: { zones } } });
  return { ...fixture, waitingIds };
}

function candidateTable() {
  const fixture = compactHand();
  const view = store().playerViewState!;
  useGameStore.setState({
    playerViewState: {
      ...view,
      activeEffect: { ...view.activeEffect!, selectableObjectIds: fixture.ids.slice(0, 8) },
    },
  });
  return fixture;
}

recovery();
function payment(play = true) {
  recovery();
  const session = store().gameSession;
  (session as any).authorityState = { ...session.state, manualOperationMode: 'RULES' };
  store().syncState();
  return play ? store().playMemberToSlot('hand-0', SlotPosition.LEFT) : null;
}
const acks: string[] = [];
let ginkoFixture: ReturnType<typeof prepareGinkoScenario>;
function prepareAbilityTransfer(holdAck = true) {
  ginkoFixture = prepareGinkoScenario({ mode: 'LOCAL', relay: 'none' });
  if (!ginkoFixture.play().success || !ginkoFixture.ack().success) {
    throw new Error('Unable to prepare the real Ginko entrance');
  }
  acks.length = 0;
  useGameStore.setState({
    gameSession: ginkoFixture.session,
    viewingPlayerId: 'p1',
    replaySession: null,
    remoteSession: null,
    acknowledgeCardEntrance: (id) => {
      acks.push(id);
      return holdAck ? { success: false, pending: true } : realEntranceAck(id);
    },
  });
  store().loadCardData(
    [...ginkoFixture.session.state!.cardRegistry.values()].map((c) => c.data as AnyCardData)
  );
  store().syncState();
}
function startAbilityTransfer() {
  if (!ginkoFixture.activate().success || !ginkoFixture.discard().success) {
    throw new Error('Unable to pay the real ability-copy cost');
  }
  store().syncState();
  return store().playerViewState!.match.entrance!.id;
}
function finishAbilityTransfer() {
  const token = store().playerViewState?.match.entrance?.id;
  if (token && !realEntranceAck(token).success) throw new Error('Entrance ACK failed');
  const effect = ginkoFixture.session.state!.activeEffect;
  if (effect) store().confirmEffectStep(effect.id, effect.selectableCardIds?.[0]);
}
function entrance(withProfile = false) {
  recovery();
  acks.length = 0;
  const view = store().playerViewState!;
  useGameStore.setState({
    playerViewState: {
      ...view,
      objects: withProfile
        ? {
            ...view.objects,
            obj_source: {
              ...view.objects.obj_source,
              frontInfo: { ...view.objects.obj_source.frontInfo!, cardCode: 'PL!N-bp7-006-P' },
            },
          }
        : view.objects,
      match: {
        ...view.match,
        entrance: {
          id: 'barrier-token',
          objectIds: withProfile ? ['obj_source'] : [],
          waitingSeats: ['FIRST', 'SECOND'],
          deadlineAt: Date.now() + 4000,
        },
      },
    },
    acknowledgeCardEntrance: (id) => {
      acks.push(id);
      return { success: false, pending: true };
    },
  });
}
function score() {
  prepareCheer(false, 3, false, 2, true);
  const session = store().gameSession;
  (session as any).authorityState = {
    ...session.state,
    currentPhase: GamePhase.LIVE_RESULT_PHASE,
    currentSubPhase: SubPhase.RESULT_SCORE_CONFIRM,
    liveResolution: {
      ...session.state!.liveResolution,
      liveResults: new Map([
        ['live-0', true],
        ['live-1', true],
      ]),
      playerScores: new Map([
        ['p1', 4],
        ['p2', 0],
      ]),
      confirmedScorePlayerIds: [],
    },
  };
  store().syncState();
}
function paymentContract(special: boolean) {
  recovery();
  submissions.length = 0;
  const view = store().playerViewState!;
  useGameStore.setState({
    playerViewState: {
      ...view,
      permissions: {
        availableCommands: [
          {
            command: special
              ? GameCommandType.CONFIRM_SPECIAL_MEMBER_PLAY
              : GameCommandType.CONFIRM_COST_PAYMENT,
            enabled: true,
          },
        ],
      },
      pendingSpecialMemberPlay: special
        ? {
            id: 'special-payment',
            playerSeat: 'FIRST',
            waiting: true,
            sourceObjectId: 'obj_hand-0',
            candidateObjectIds: ['obj_hand-1', 'obj_hand-2'],
            minSelectableObjects: 1,
            maxSelectableObjects: 1,
            selectionLabel: '特殊登场支付',
            stepText: '选择一张手牌支付费用。',
            confirmSelectionLabel: '确认特殊支付',
          }
        : null,
      pendingCostPayment: special
        ? null
        : {
            id: 'cost-payment',
            source: 'PLAY_MEMBER',
            sourceObjectId: 'obj_hand-0',
            playerSeat: 'FIRST',
            baseCost: 4,
            finalEnergyCost: 2,
            relayDiscount: 2,
            replacedMemberObjectId: null,
            payableEnergyObjectIds: ['obj_e1', 'obj_e2'],
            explanation: '权威费用：4 减 2 = 2',
          },
    },
    confirmSpecialMemberPlay: (...args) => {
      submissions.push(args);
      return { success: true };
    },
    cancelSpecialMemberPlay: (...args) => {
      submissions.push(['cancel', ...args]);
      return { success: true };
    },
    confirmCostPayment: (...args) => {
      submissions.push(args);
      return { success: true };
    },
  });
}
function formation() {
  selection('formation');
  const view = store().playerViewState!;
  useGameStore.setState({
    playerViewState: {
      ...view,
      activeEffect: {
        ...view.activeEffect!,
        selectableObjectIds: [],
        stageFormation: {
          playerSeat: 'FIRST',
          slots: [
            {
              slot: 'LEFT',
              cardId: 'source',
              objectId: 'obj_source',
              originalSlot: 'LEFT',
              energyBelowCount: 1,
              memberBelowCount: 0,
            },
            {
              slot: 'CENTER',
              cardId: null,
              objectId: null,
              originalSlot: 'CENTER',
              energyBelowCount: 0,
              memberBelowCount: 0,
            },
            {
              slot: 'RIGHT',
              cardId: null,
              objectId: null,
              originalSlot: 'RIGHT',
              energyBelowCount: 0,
              memberBelowCount: 0,
            },
          ],
        },
      },
    },
  });
}
(window as any).excelReview = {
  hiddenCandidates: () => {
    const fixture = stageDetails();
    const view = store().playerViewState!;
    useGameStore.setState({
      playerViewState: {
        ...view,
        activeEffect: {
          ...view.activeEffect!,
          selectableObjectIds: [`obj_${fixture.prefix}secret`],
        },
      },
    });
  },
  candidateStates: (blocked = false) => {
    const fixture = stageDetails();
    const view = store().playerViewState!;
    const energyId = `obj_${fixture.prefix}energy-0`;
    const handId = `obj_${fixture.first}`;
    useGameStore.setState({
      playerViewState: {
        ...view,
        permissions: blocked ? { availableCommands: [] } : view.permissions,
        objects: {
          ...view.objects,
          [energyId]: {
            ...view.objects[energyId],
            orientation: OrientationState.WAITING,
            skipsNextActivePhase: true,
          },
          [handId]: { ...view.objects[handId], skipsNextActivePhase: true },
        },
        activeEffect: {
          ...view.activeEffect!,
          selectableObjectIds: [`obj_${fixture.prefix}source`, energyId, handId],
        },
      },
    });
  },
  compactZones,
  candidateTable,
  compactHand,
  stageDetails,
  handDetails,
  payment,
  paymentContract,
  formation,
  entrance,
  prepareAbilityTransfer,
  startAbilityTransfer,
  finishAbilityTransfer,
  acks,
  score,
  recovery,
  selection,
  submissions,
  cheer: prepareCheer,
  store,
  expireCandidate: () => {
    const view = store().playerViewState!;
    useGameStore.setState({
      playerViewState: {
        ...view,
        activeEffect: { ...view.activeEffect!, selectableObjectIds: ['obj_hand-1', 'obj_hand-2'] },
      },
    });
  },
};
createRoot(document.getElementById('root')!).render(
  <PresentationRoot>
    <div style={{ height: 'calc(100dvh - var(--excel-toolbar-height, 0px))' }}>
      {new URLSearchParams(location.search).has('frame') ? (
        <ProductFrame
          active="battle"
          navigation={{ onHome() {}, onDecks() {}, onBattle() {}, onSpectate() {}, onHistory() {} }}
          actions={<button>返回大厅</button>}
        >
          <GameBoard />
        </ProductFrame>
      ) : (
        <GameBoard />
      )}
    </div>
  </PresentationRoot>
);

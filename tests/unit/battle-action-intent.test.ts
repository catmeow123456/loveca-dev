import { describe, expect, it } from 'vitest';
import {
  buildBattleActionIntents,
  findEnabledBattleActionSlotTarget,
  findEnabledBattleActionTargetByTargetId,
  findEnabledBattleActionTargetForZoneDrop,
} from '../../client/src/lib/battleActionIntent';
import { GameCommandType } from '../../src/application/game-commands';
import type { ActiveEffectViewState, Seat } from '../../src/online';
import {
  CardType,
  GamePhase,
  SlotPosition,
  SubPhase,
  ZoneType,
} from '../../src/shared/types/enums';

const MEMBER_SLOTS = [
  { seat: 'FIRST' as Seat, slot: SlotPosition.LEFT, cardId: null },
  { seat: 'FIRST' as Seat, slot: SlotPosition.CENTER, cardId: 'center-member' },
  { seat: 'FIRST' as Seat, slot: SlotPosition.RIGHT, cardId: null },
];

const BASE_INPUT = {
  currentPhase: GamePhase.MAIN_PHASE,
  currentSubPhase: SubPhase.NONE,
  actorSeat: 'FIRST' as Seat,
  viewerSeat: 'FIRST' as Seat,
  surface: 'LOCAL_DEBUG' as const,
  isReadOnly: false,
  memberSlots: MEMBER_SLOTS,
  availableCommandTypes: [
    GameCommandType.PLAY_MEMBER_TO_SLOT,
    GameCommandType.MOVE_MEMBER_TO_SLOT,
    GameCommandType.ATTACH_ENERGY_TO_MEMBER,
    GameCommandType.SET_LIVE_CARD,
    GameCommandType.MOVE_PUBLIC_CARD_TO_HAND,
    GameCommandType.MOVE_PUBLIC_CARD_TO_WAITING_ROOM,
    GameCommandType.MOVE_PUBLIC_CARD_TO_ENERGY_DECK,
    GameCommandType.MOVE_INSPECTED_CARD_TO_ZONE,
    GameCommandType.MOVE_INSPECTED_CARD_TO_TOP,
    GameCommandType.MOVE_INSPECTED_CARD_TO_BOTTOM,
    GameCommandType.MOVE_RESOLUTION_CARD_TO_ZONE,
    GameCommandType.CONFIRM_EFFECT_STEP,
  ],
};

describe('buildBattleActionIntents', () => {
  it('creates member play slot targets from a selected hand member', () => {
    const intents = buildBattleActionIntents({
      ...BASE_INPUT,
      sourceCardId: 'hand-member',
      sourceZone: ZoneType.HAND,
      sourceCardType: CardType.MEMBER,
    });

    const playIntent = intents.find(
      (intent) => intent.commandType === GameCommandType.PLAY_MEMBER_TO_SLOT
    );
    expect(playIntent?.label).toBe('登场');
    expect(playIntent?.targets.map((target) => target.label)).toEqual(['登场', '换手登场', '登场']);
    const leftTarget = findEnabledBattleActionSlotTarget(
      intents,
      ZoneType.MEMBER_SLOT,
      SlotPosition.LEFT
    );
    expect(leftTarget?.target.commandPayload).toEqual({
      type: GameCommandType.PLAY_MEMBER_TO_SLOT,
      cardId: 'hand-member',
      targetSlot: SlotPosition.LEFT,
    });
  });

  it('creates member movement targets excluding the source slot', () => {
    const intents = buildBattleActionIntents({
      ...BASE_INPUT,
      sourceCardId: 'center-member',
      sourceZone: ZoneType.MEMBER_SLOT,
      sourceCardType: CardType.MEMBER,
      sourceSlot: SlotPosition.CENTER,
    });

    const moveIntent = intents.find(
      (intent) => intent.commandType === GameCommandType.MOVE_MEMBER_TO_SLOT
    );
    expect(moveIntent?.targets.map((target) => target.slot)).toEqual([
      SlotPosition.LEFT,
      SlotPosition.RIGHT,
    ]);
  });

  it('creates face-down live placement during live set task windows', () => {
    const intents = buildBattleActionIntents({
      ...BASE_INPUT,
      currentPhase: GamePhase.LIVE_SET_PHASE,
      currentSubPhase: SubPhase.LIVE_SET_FIRST_PLAYER,
      sourceCardId: 'hand-card',
      sourceZone: ZoneType.HAND,
      sourceCardType: CardType.LIVE,
      liveZoneCount: 2,
    });

    expect(intents).toHaveLength(1);
    expect(intents[0]?.commandType).toBe(GameCommandType.SET_LIVE_CARD);
    expect(intents[0]?.targets[0]?.commandPayload).toEqual({
      type: GameCommandType.SET_LIVE_CARD,
      cardId: 'hand-card',
      faceDown: true,
    });
  });

  it('keeps live set as the priority task for any hand card', () => {
    const intents = buildBattleActionIntents({
      ...BASE_INPUT,
      currentPhase: GamePhase.LIVE_SET_PHASE,
      currentSubPhase: SubPhase.LIVE_SET_SECOND_PLAYER,
      sourceCardId: 'hand-member',
      sourceZone: ZoneType.HAND,
      sourceCardType: CardType.MEMBER,
      liveZoneCount: 0,
    });

    expect(intents).toHaveLength(1);
    expect(intents[0]?.commandType).toBe(GameCommandType.SET_LIVE_CARD);
  });

  it('finds a shared drop target for drag and click paths', () => {
    const intents = buildBattleActionIntents({
      ...BASE_INPUT,
      sourceCardId: 'center-member',
      sourceZone: ZoneType.MEMBER_SLOT,
      sourceCardType: CardType.MEMBER,
      sourceSlot: SlotPosition.CENTER,
    });

    const target = findEnabledBattleActionTargetForZoneDrop(
      intents,
      ZoneType.MEMBER_SLOT,
      SlotPosition.RIGHT
    );

    expect(target?.target.commandPayload).toEqual({
      type: GameCommandType.MOVE_MEMBER_TO_SLOT,
      cardId: 'center-member',
      sourceSlot: SlotPosition.CENTER,
      targetSlot: SlotPosition.RIGHT,
    });
  });

  it('does not emit tabletop intents in readonly mode', () => {
    const intents = buildBattleActionIntents({
      ...BASE_INPUT,
      isReadOnly: true,
      sourceCardId: 'hand-member',
      sourceZone: ZoneType.HAND,
      sourceCardType: CardType.MEMBER,
    });

    expect(intents).toEqual([]);
  });

  it('prioritizes active effect targets over ordinary tabletop actions', () => {
    const activeEffect: ActiveEffectViewState = {
      id: 'effect-1',
      abilityId: 'ability-1',
      sourceObjectId: 'obj_source-member',
      controllerSeat: 'FIRST',
      effectText: '选择一个成员区。',
      stepId: 'slot',
      stepText: '选择登场位置。',
      waitingSeat: 'FIRST',
      selectableSlots: [SlotPosition.LEFT],
      confirmSelectionLabel: '登场',
    };
    const intents = buildBattleActionIntents({
      ...BASE_INPUT,
      sourceCardId: 'source-member',
      sourceZone: ZoneType.HAND,
      sourceCardType: CardType.MEMBER,
      activeEffect,
      activeEffectCanConfirm: true,
    });

    expect(intents).toHaveLength(1);
    expect(intents[0]?.isEffectStep).toBe(true);
    expect(intents[0]?.commandType).toBe(GameCommandType.CONFIRM_EFFECT_STEP);
    expect(intents[0]?.targets[0]?.commandPayload).toEqual({
      type: GameCommandType.CONFIRM_EFFECT_STEP,
      effectId: 'effect-1',
      selectedSlot: SlotPosition.LEFT,
    });
  });

  it('creates click targets for inspected cards', () => {
    const intents = buildBattleActionIntents({
      ...BASE_INPUT,
      sourceCardId: 'inspected-card',
      sourceZone: ZoneType.INSPECTION_ZONE,
      sourceCardType: CardType.LIVE,
    });

    expect(
      findEnabledBattleActionTargetByTargetId(intents, 'inspection-target-hand')?.target
        .commandPayload
    ).toEqual({
      type: GameCommandType.MOVE_INSPECTED_CARD_TO_ZONE,
      cardId: 'inspected-card',
      toZone: ZoneType.HAND,
    });
    expect(
      findEnabledBattleActionTargetByTargetId(intents, 'inspection-target-waiting-room')?.target
        .commandPayload
    ).toEqual({
      type: GameCommandType.MOVE_INSPECTED_CARD_TO_ZONE,
      cardId: 'inspected-card',
      toZone: ZoneType.WAITING_ROOM,
    });
    expect(
      findEnabledBattleActionTargetByTargetId(intents, 'inspection-target-main-deck-top')?.target
        .commandPayload
    ).toEqual({
      type: GameCommandType.MOVE_INSPECTED_CARD_TO_TOP,
      cardId: 'inspected-card',
    });
    expect(
      findEnabledBattleActionTargetByTargetId(intents, 'inspection-target-main-deck-bottom')?.target
        .commandPayload
    ).toEqual({
      type: GameCommandType.MOVE_INSPECTED_CARD_TO_BOTTOM,
      cardId: 'inspected-card',
    });
  });

  it('creates click targets for resolution cards', () => {
    const intents = buildBattleActionIntents({
      ...BASE_INPUT,
      sourceCardId: 'resolution-card',
      sourceZone: ZoneType.RESOLUTION_ZONE,
      sourceCardType: CardType.MEMBER,
    });

    expect(
      findEnabledBattleActionTargetByTargetId(intents, 'resolution-target-hand')?.target
        .commandPayload
    ).toEqual({
      type: GameCommandType.MOVE_RESOLUTION_CARD_TO_ZONE,
      cardId: 'resolution-card',
      toZone: ZoneType.HAND,
    });
    expect(
      findEnabledBattleActionTargetByTargetId(intents, 'resolution-target-waiting-room')?.target
        .commandPayload
    ).toEqual({
      type: GameCommandType.MOVE_RESOLUTION_CARD_TO_ZONE,
      cardId: 'resolution-card',
      toZone: ZoneType.WAITING_ROOM,
    });
    expect(
      findEnabledBattleActionTargetByTargetId(intents, 'resolution-target-main-deck-top')?.target
        .commandPayload
    ).toEqual({
      type: GameCommandType.MOVE_RESOLUTION_CARD_TO_ZONE,
      cardId: 'resolution-card',
      toZone: ZoneType.MAIN_DECK,
      position: 'TOP',
    });
  });
});

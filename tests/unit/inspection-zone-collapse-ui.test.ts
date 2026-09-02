import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlayerArea } from '../../client/src/components/game/PlayerArea';
import { buildInspectionZoneInteractionKey } from '../../client/src/lib/inspectionZoneUi';
import { useGameStore } from '../../client/src/store/gameStore';
import { GameCommandType } from '../../src/application/game-commands';
import type {
  ActiveEffectViewState,
  MatchViewState,
  PlayerViewState,
} from '../../src/online/types';
import { CardType, GameMode, GamePhase, SubPhase, ZoneType } from '../../src/shared/types/enums';

vi.mock('@/lib/imageService', () => ({
  preloadImage: vi.fn(() => Promise.resolve()),
  resolveCardImagePath: vi.fn(() => '/images/medium/mock.webp'),
}));

const requireFromClient = createRequire(new URL('../../client/package.json', import.meta.url));
const { createElement } = requireFromClient('react') as {
  readonly createElement: (...args: readonly unknown[]) => unknown;
};
const { renderToStaticMarkup } = requireFromClient('react-dom/server') as {
  readonly renderToStaticMarkup: (element: unknown) => string;
};
const { DndContext } = requireFromClient('@dnd-kit/core') as {
  readonly DndContext: unknown;
};

const INSPECTED_CARD_ID = 'inspection-card';
const INSPECTED_OBJECT_ID = `obj_${INSPECTED_CARD_ID}`;

function createMatchView(overrides: Partial<MatchViewState> = {}): MatchViewState {
  return {
    matchId: 'inspection-ui-match',
    viewerSeat: 'FIRST',
    participants: {
      FIRST: { id: 'player-1', name: '玩家一' },
      SECOND: { id: 'player-2', name: '玩家二' },
    },
    turnCount: 1,
    phase: GamePhase.MAIN_PHASE,
    subPhase: SubPhase.NONE,
    firstSeat: 'FIRST',
    activeSeat: 'FIRST',
    prioritySeat: 'FIRST',
    window: {
      windowType: 'INSPECTION',
      status: 'OPENED',
      actingSeat: 'FIRST',
      waitingSeats: ['FIRST'],
      context: { sourceZone: ZoneType.MAIN_DECK, activeEffectId: 'effect-1' },
    },
    endInfo: null,
    manualOperation: {
      mode: 'RULES',
      canSwitchNow: false,
      disabledReason: '当前处于检视流程',
      pendingRequest: null,
    },
    seq: 1,
    ...overrides,
  };
}

function createActiveEffect(stepId = 'select-card'): ActiveEffectViewState {
  return {
    id: 'effect-1',
    abilityId: 'test:inspection',
    sourceObjectId: 'obj_source',
    controllerSeat: 'FIRST',
    effectText: '检视自己卡组顶的 1 张卡。',
    stepId,
    stepText: '请选择要处理的卡牌',
    waitingSeat: 'FIRST',
    inspectionObjectIds: [INSPECTED_OBJECT_ID],
    selectableObjectIds: [INSPECTED_OBJECT_ID],
  };
}

function createPlayerViewState(): PlayerViewState {
  return {
    match: createMatchView(),
    table: {
      zones: {
        FIRST_INSPECTION_ZONE: {
          zone: ZoneType.INSPECTION_ZONE,
          ownerSeat: 'FIRST',
          count: 1,
          ordered: true,
          objectIds: [INSPECTED_OBJECT_ID],
        },
      },
    },
    objects: {
      [INSPECTED_OBJECT_ID]: {
        publicObjectId: INSPECTED_OBJECT_ID,
        ownerSeat: 'FIRST',
        controllerSeat: 'FIRST',
        cardType: CardType.MEMBER,
        surface: 'FRONT',
        frontInfo: {
          cardCode: 'TEST-INSPECTION-001',
          nameCn: '检视测试卡',
          cardType: CardType.MEMBER,
          cost: 1,
        },
      },
    },
    permissions: {
      availableCommands: [
        {
          command: GameCommandType.FINISH_INSPECTION,
          enabled: false,
          reason: '卡效检视由效果窗口处理',
        },
      ],
    },
    activeEffect: createActiveEffect(),
    pendingCostPayment: null,
    uiHints: { gameMode: GameMode.DEBUG },
  };
}

function renderPlayerArea(collapsed: boolean): string {
  return renderToStaticMarkup(
    createElement(
      DndContext,
      null,
      createElement(PlayerArea, {
        playerSeat: 'FIRST',
        isOpponent: false,
        isActive: true,
        isInspectionZoneCollapsed: collapsed,
        onInspectionZoneCollapsedChange: vi.fn(),
      })
    )
  );
}

describe('inspection zone collapse UI', () => {
  beforeEach(() => {
    useGameStore.setState({
      gameMode: GameMode.DEBUG,
      playerViewState: createPlayerViewState(),
      viewingPlayerId: 'player-1',
      replaySession: null,
      remoteSession: null,
    });
  });

  afterEach(() => {
    useGameStore.setState({
      playerViewState: null,
      viewingPlayerId: null,
      replaySession: null,
      remoteSession: null,
    });
  });

  it('renders cards and the hide control while expanded', () => {
    const markup = renderPlayerArea(false);

    expect(markup).toContain('data-inspection-zone-collapsed="false"');
    expect(markup).toContain('aria-label="隐藏检视区"');
    expect(markup).toContain(`data-card-id="${INSPECTED_CARD_ID}"`);
  });

  it('renders only the compact count and expand control while preserving the animation anchor', () => {
    const markup = renderPlayerArea(true);

    expect(markup).toContain('data-inspection-zone-collapsed="true"');
    expect(markup).toContain('aria-label="展开检视区"');
    expect(markup).toContain('data-animation-zone-id="seat-FIRST::inspection-zone"');
    expect(markup).not.toContain(`data-card-id="${INSPECTED_CARD_ID}"`);
  });
});

describe('inspection zone interaction key', () => {
  it('is absent outside inspection windows', () => {
    expect(
      buildInspectionZoneInteractionKey(createMatchView({ window: null }), createActiveEffect())
    ).toBeNull();
  });

  it('does not depend on snapshot sequence or inspection card count', () => {
    const activeEffect = createActiveEffect();
    const original = buildInspectionZoneInteractionKey(createMatchView(), activeEffect);
    const refreshed = buildInspectionZoneInteractionKey(createMatchView({ seq: 99 }), {
      ...activeEffect,
      inspectionObjectIds: ['obj_changed'],
      selectableObjectIds: ['obj_changed'],
    });

    expect(refreshed).toBe(original);
  });

  it('changes for a new effect step, match, acting seat, source zone, or effect', () => {
    const original = buildInspectionZoneInteractionKey(createMatchView(), createActiveEffect());
    const changedKeys = [
      buildInspectionZoneInteractionKey(createMatchView(), createActiveEffect('public-reveal')),
      buildInspectionZoneInteractionKey(
        createMatchView({ matchId: 'next-match' }),
        createActiveEffect()
      ),
      buildInspectionZoneInteractionKey(
        createMatchView({
          window: {
            ...createMatchView().window!,
            actingSeat: 'SECOND',
          },
        }),
        createActiveEffect()
      ),
      buildInspectionZoneInteractionKey(
        createMatchView({
          window: {
            ...createMatchView().window!,
            context: { sourceZone: ZoneType.ENERGY_DECK, activeEffectId: 'effect-1' },
          },
        }),
        createActiveEffect()
      ),
      buildInspectionZoneInteractionKey(
        createMatchView({
          window: {
            ...createMatchView().window!,
            context: { sourceZone: ZoneType.MAIN_DECK, activeEffectId: 'effect-2' },
          },
        }),
        { ...createActiveEffect(), id: 'effect-2' }
      ),
    ];

    for (const changedKey of changedKeys) {
      expect(changedKey).not.toBe(original);
    }
  });
});

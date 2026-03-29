/**
 * 游戏主界面布局
 */

import { memo, useState, useCallback, useEffect, useRef } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
} from '@dnd-kit/core';
import { useShallow } from 'zustand/react/shallow';
import { useGameStore } from '@/store/gameStore';
import { PlayerArea } from './PlayerArea';
import { GameLog } from './GameLog';
import { PhaseIndicator } from './PhaseIndicator';
import { PhaseBanner } from './PhaseBanner';
import { LiveResultAnimation, type LiveResultType, type LiveScoreInfo } from './LiveResultAnimation';
import { DebugControl } from './DebugControl';
import { CardDetailOverlay } from './CardDetailOverlay';
import { JudgmentPanel } from './JudgmentPanel';
import { ScoreConfirmModal } from './ScoreConfirmModal';
import { Card } from '@/components/card/Card';
import { MulliganPanel } from './MulliganPanel';
import { ThemeToggle } from '@/components/common';
import { getDeckBackUrl } from '@/lib/imageService';
import { parseZoneId, findCardZone } from '@/lib/zoneUtils';
import { SlotPosition, GamePhase, SubPhase, ZoneType, CardType, GameMode } from '@game/shared/types/enums';
import type { AnyCardData } from '@game/domain/entities/card';

export const GameBoard = memo(function GameBoard() {
  // 配置拖拽传感器：需要移动 5px 才开始拖拽，避免与双击冲突
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    })
  );

  // 状态选择器
  const gameState = useGameStore((s) => s.gameState);
  const viewingPlayerId = useGameStore((s) => s.viewingPlayerId);
  const gameMode = useGameStore((s) => s.gameMode);

  // 方法选择器（使用 useShallow 保持引用稳定）
  const { setLiveCard, addLog, manualMoveCard, setDragHints } = useGameStore(
    useShallow((s) => ({
      setLiveCard: s.setLiveCard,
      addLog: s.addLog,
      manualMoveCard: s.manualMoveCard,
      setDragHints: s.setDragHints,
    }))
  );

  // 卡牌辅助方法（使用 useShallow 保持引用稳定）
  const { getCardInstance, getCardImagePath } = useGameStore(
    useShallow((s) => ({
      getCardInstance: s.getCardInstance,
      getCardImagePath: s.getCardImagePath,
    }))
  );

  // 拖拽状态
  const [activeCardId, setActiveCardId] = useState<string | null>(null);

  // Live 结果动画状态
  const [liveResult, setLiveResult] = useState<LiveResultType>(null);
  const prevPhaseRef = useRef<GamePhase | null>(null);
  const prevSuccessCountRef = useRef<number>(0);

  // 派生状态：直接从 gameState 读取，无需 useEffect + setState
  const currentSubPhase = gameState?.currentSubPhase ?? SubPhase.NONE;
  const currentPhase = gameState?.currentPhase ?? null;
  const mulliganPanelOpen = currentPhase === GamePhase.MULLIGAN_PHASE;

  // 左侧判定区抽屉开关（可在任意阶段手动唤出）
  const [judgmentPanelOpen, setJudgmentPanelOpen] = useState(false);

  // 弹窗回调
  const handleJudgmentPanelClose = useCallback(() => {
    setJudgmentPanelOpen(false);
  }, []);

  // 打开判定面板（由 PhaseIndicator 的判定按钮调用）
  const handleOpenJudgmentPanel = useCallback(() => {
    setJudgmentPanelOpen(true);
  }, []);

  // 监听阶段变化，触发 Live 结果动画（使用 setTimeout 避免同步 setState）
  useEffect(() => {
    if (!gameState) return;

    const currentPhase = gameState.currentPhase;
    const prevPhase = prevPhaseRef.current;
    
    // 获取己方成功 Live 数量
    const selfIndex = gameState.players.findIndex((p) => p.id === viewingPlayerId);
    const self = gameState.players[selfIndex] ?? gameState.players[0];
    const currentSuccessCount = self.successZone.cardIds.length;

    // 当从 LIVE_RESULT_PHASE 切换时，检查成功 Live 是否增加
    if (prevPhase === GamePhase.LIVE_RESULT_PHASE && currentPhase !== GamePhase.LIVE_RESULT_PHASE) {
      if (currentSuccessCount > prevSuccessCountRef.current) {
        // 使用 setTimeout 将 setState 推迟到下一个事件循环
        setTimeout(() => setLiveResult('success'), 0);
      }
    }

    // 当进入 PERFORMANCE_PHASE 时，显示 Live 开始提示
    if (currentPhase === GamePhase.PERFORMANCE_PHASE && prevPhase !== GamePhase.PERFORMANCE_PHASE) {
      addLog('🎤 Live 表演开始!', 'phase');
    }

    prevPhaseRef.current = currentPhase;
    prevSuccessCountRef.current = currentSuccessCount;
  }, [gameState, viewingPlayerId, addLog]);

  // Live 动画完成回调
  const handleLiveAnimationComplete = useCallback(() => {
    setLiveResult(null);
  }, []);

  // 拖拽开始处理
  const handleDragStart = useCallback((event: DragStartEvent) => {
    const cardId = event.active.id as string;
    setActiveCardId(cardId);

    // 计算"推荐目标"高亮（只提示，不限制放置）
    const dragData = event.active.data.current as { fromZone?: ZoneType } | undefined;
    const fromZone = dragData?.fromZone;
    const sub = gameState?.currentSubPhase ?? SubPhase.NONE;

    const suggested: string[] = [];
    // Live 设置：推荐手牌 -> Live 区
    if (
      gameState?.currentPhase === GamePhase.LIVE_SET_PHASE &&
      (sub === SubPhase.LIVE_SET_FIRST_PLAYER || sub === SubPhase.LIVE_SET_SECOND_PLAYER) &&
      fromZone === ZoneType.HAND
    ) {
      suggested.push('live-zone');
    }
    // 结算：推荐 Live 区 -> 成功区 / 休息室
    if (
      gameState?.currentPhase === GamePhase.LIVE_RESULT_PHASE &&
      sub === SubPhase.RESULT_SETTLEMENT
    ) {
      if (fromZone === ZoneType.LIVE_ZONE) {
        suggested.push('success-zone', 'waiting-room');
      }
      if (fromZone === ZoneType.RESOLUTION_ZONE) {
        suggested.push('waiting-room');
      }
    }

    setDragHints(true, suggested);
  }, [gameState, setDragHints]);

  // 拖拽结束处理 - 统一处理所有区域间的拖拽
  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      setActiveCardId(null);
      setDragHints(false);

      if (!over || !gameState || !viewingPlayerId) return;

      const cardId = active.id as string;
      const targetId = over.id as string;

      // 获取拖拽数据中的来源区域信息
      const dragData = active.data.current as {
        cardId: string;
        cardCode?: string;
        fromZone?: ZoneType;
      } | undefined;

      // 解析目标区域
      const parsedTarget = parseZoneId(targetId);
      if (!parsedTarget) {
        // 无法识别的目标区域
        return;
      }

      const { zoneType: toZone, slotPosition: targetSlot } = parsedTarget;

      // 获取来源区域（优先从拖拽数据获取，否则查找）
      const fromZone = dragData?.fromZone || findCardZone(cardId, gameState, viewingPlayerId);
      if (!fromZone) {
        addLog('无法确定卡牌来源区域', 'error');
        return;
      }

      // 获取卡牌实例用于类型检查
      const cardInstance = getCardInstance(cardId);

      // 能量牌移动限制（规则 4.5.5、10.5.4）
      if (cardInstance?.data.cardType === CardType.ENERGY) {
        if (toZone === ZoneType.HAND) {
          addLog('能量牌不能移动到手牌', 'error');
          return;
        }
        if (toZone === ZoneType.LIVE_ZONE) {
          addLog('能量牌不能移动到LIVE区', 'error');
          return;
        }
        if (toZone === ZoneType.SUCCESS_ZONE) {
          addLog('能量牌不能移动到成功LIVE卡区', 'error');
          return;
        }
        if (toZone === ZoneType.WAITING_ROOM) {
          addLog('能量牌不能移动到休息室（请移动到能量卡组）', 'error');
          return;
        }
      }

      // LIVE卡移动限制：不能放入成员区和能量区和能量卡组
      if (cardInstance?.data.cardType === CardType.LIVE) {
        if (toZone === ZoneType.MEMBER_SLOT) {
          addLog('LIVE卡不能放入成员区', 'error');
          return;
        }
        if (toZone === ZoneType.ENERGY_ZONE) {
          addLog('LIVE卡不能放入能量区', 'error');
          return;
        }
        if (toZone === ZoneType.ENERGY_DECK) {
          addLog('LIVE卡不能放入能量卡组', 'error');
          return;
        }
      }

      // 成员卡移动限制：不能放入能量区和能量卡组
      if (cardInstance?.data.cardType === CardType.MEMBER) {
        if (toZone === ZoneType.ENERGY_ZONE) {
          addLog('成员卡不能放入能量区', 'error');
          return;
        }
        if (toZone === ZoneType.ENERGY_DECK) {
          addLog('成员卡不能放入能量卡组', 'error');
          return;
        }
      }

      // Live 设置阶段：拖到 Live 区的一律视为"里侧放置"（规则 8.2），且可作为 Live 卡放置（不限制卡牌类型）
      // 用专门动作而不是 manualMoveCard，确保 liveZone.cardStates 的 face 被正确设置为 FACE_DOWN。
      if (
        gameState.currentPhase === GamePhase.LIVE_SET_PHASE &&
        fromZone === ZoneType.HAND &&
        toZone === ZoneType.LIVE_ZONE
      ) {
        const result = setLiveCard(cardId, true);
        if (result.success) {
          addLog('放置 Live 卡: 手牌 → Live 区（里侧）', 'action');
        }
        return;
      }

      // 如果来源和目标相同，不执行移动
      if (fromZone === toZone) {
        // 特殊情况：成员槽位之间的移动需要检查具体槽位
        if (toZone === ZoneType.MEMBER_SLOT) {
          // 如果是同一个槽位，不移动
          const selfIndex = gameState.players.findIndex((p) => p.id === viewingPlayerId);
          const self = gameState.players[selfIndex] ?? gameState.players[0];
          for (const slot of Object.values(SlotPosition)) {
            if (self.memberSlots.slots[slot] === cardId && slot === targetSlot) {
              return; // 同一槽位，不移动
            }
          }
        } else {
          return; // 同一区域，不移动
        }
      }

      // 生成日志消息
      const zoneNames: Record<ZoneType, string> = {
        [ZoneType.HAND]: '手牌',
        [ZoneType.MAIN_DECK]: '主卡组',
        [ZoneType.ENERGY_DECK]: '能量卡组',
        [ZoneType.MEMBER_SLOT]: '成员区',
        [ZoneType.ENERGY_ZONE]: '能量区',
        [ZoneType.LIVE_ZONE]: 'Live 区',
        [ZoneType.SUCCESS_ZONE]: '成功区',
        [ZoneType.WAITING_ROOM]: '休息室',
        [ZoneType.EXILE_ZONE]: '除外区',
        [ZoneType.RESOLUTION_ZONE]: '解决区',
      };

      // 找出来源槽位（当从成员区移动时，用于携带 energyBelow，规则 4.5.5.3）
      let sourceSlot: SlotPosition | undefined;
      if (fromZone === ZoneType.MEMBER_SLOT) {
        const selfIndex = gameState.players.findIndex((p) => p.id === viewingPlayerId);
        const self = gameState.players[selfIndex] ?? gameState.players[0];
        for (const slot of Object.values(SlotPosition)) {
          if (self.memberSlots.slots[slot] === cardId) {
            sourceSlot = slot;
            break;
          }
        }
      }

      // 执行移动
      const result = manualMoveCard(cardId, fromZone, toZone, {
        targetSlot,
        sourceSlot,
        position: 'TOP', // 默认放到顶部（卡组时）
      });

      if (result.success) {
        const fromName = zoneNames[fromZone] || fromZone;
        const toName = zoneNames[toZone] || toZone;
        addLog(`移动卡牌: ${fromName} → ${toName}`, 'action');
      }
    },
    [manualMoveCard, setLiveCard, addLog, gameState, viewingPlayerId, setDragHints, getCardInstance]
  );

  // 获取当前拖拽中的卡牌实例
  const activeCard = activeCardId ? getCardInstance(activeCardId) : null;

  if (!gameState) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-slate-400">游戏未开始</div>
      </div>
    );
  }

  // 确定对手和自己
  const selfIndex = gameState.players.findIndex((p) => p.id === viewingPlayerId);
  const self = gameState.players[selfIndex] ?? gameState.players[0];
  const opponent = gameState.players[selfIndex === 0 ? 1 : 0];
  const isSolitaire = gameMode === GameMode.SOLITAIRE;

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => {
        setActiveCardId(null);
        setDragHints(false);
      }}
    >
      <div 
        className="h-full flex flex-col relative overflow-hidden"
        style={{
          backgroundImage: `url(${getDeckBackUrl()})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat'
        }}
      >
        <div className="pointer-events-none absolute inset-0 bg-[var(--board-overlay)]" />
        <div className="pointer-events-none absolute inset-0" style={{ background: 'var(--gradient-spotlight)' }} />
        <div className="pointer-events-none absolute inset-0" style={{ background: 'var(--gradient-stage-glow)' }} />

        <div className="absolute right-4 top-4 z-[80]">
          <ThemeToggle />
        </div>

        {/* 对手区域 (顶部) - 包含成员槽位和对手 Live 区 */}
        <div
          className={`relative flex-[5] min-h-0 overflow-hidden ${
            isSolitaire ? 'opacity-[0.12] pointer-events-none' : ''
          }`}
        >
          <PlayerArea
            player={opponent}
            isOpponent={true}
            isActive={gameState.activePlayerIndex === (selfIndex === 0 ? 1 : 0)}
            liveZone={opponent.liveZone}
          />
        </div>

        {/* VS 分隔线 (中央) - 对墙打模式下弱化 */}
        <div
          className="relative flex h-[32px] flex-shrink-0 items-center justify-center border-y"
          style={{
            borderColor: isSolitaire ? 'color-mix(in srgb, var(--border-default) 30%, transparent)' : 'var(--border-default)',
            background: isSolitaire
              ? 'color-mix(in srgb, var(--bg-overlay) 16%, transparent)'
              : 'linear-gradient(90deg, transparent, color-mix(in srgb, var(--accent-primary) 12%, transparent), color-mix(in srgb, var(--accent-secondary) 12%, transparent), transparent)',
          }}
        >
          <span
            className="px-4 text-lg font-bold tracking-[0.2em]"
            style={{
              color: isSolitaire ? 'var(--text-muted)' : 'var(--accent-primary)',
              textShadow: isSolitaire ? 'none' : '0 0 12px color-mix(in srgb, var(--accent-primary) 35%, transparent)',
            }}
          >
            VS
          </span>
        </div>

        {/* 己方区域 (底部) - 包含己方 Live 区和成员槽位 */}
        <div className="flex-[5] min-h-0 overflow-hidden">
          <PlayerArea
            player={self}
            isOpponent={false}
            isActive={gameState.activePlayerIndex === selfIndex}
            liveZone={self.liveZone}
          />
        </div>

        {/* 阶段指示器 */}
        <PhaseIndicator
          phase={gameState.currentPhase}
          turnNumber={gameState.turnCount}
          onOpenJudgment={handleOpenJudgmentPanel}
        />

        {/* 左侧唤出按钮（判定区关闭时显示） */}
        {!judgmentPanelOpen && (
          <button
            type="button"
            onClick={handleOpenJudgmentPanel}
            className="fixed left-0 top-1/2 z-[70] -translate-y-1/2 rounded-r-xl border border-l-0 border-[var(--border-default)] bg-[var(--bg-frosted)] px-3 py-2 text-xs font-semibold text-[var(--accent-primary)] shadow-[var(--shadow-md)] backdrop-blur-xl"
          >
            判定区
          </button>
        )}

        {/* 游戏日志 */}
        <GameLog />

        {/* 阶段提示横幅 */}
        <PhaseBanner />

        {/* 调试控制面板 */}
        <DebugControl />

        {/* 卡牌详情浮窗 */}
        <CardDetailOverlay />

        {/* Live 结果动画 */}
        <LiveResultAnimation
          result={liveResult}
          scoreInfo={liveResult ? {
            selfScore: gameState.liveResolution.playerScores.get(self.id) ?? 0,
            opponentScore: gameState.liveResolution.playerScores.get(opponent.id) ?? 0,
            selfWon: gameState.liveResolution.liveWinnerIds.includes(self.id),
            opponentWon: gameState.liveResolution.liveWinnerIds.includes(opponent.id),
            isDraw: gameState.liveResolution.liveWinnerIds.length === 2,
          } as LiveScoreInfo : null}
          onComplete={handleLiveAnimationComplete}
        />

        {/* Live 判定面板 */}
        <JudgmentPanel
          isOpen={judgmentPanelOpen}
          onClose={handleJudgmentPanelClose}
        />

        {/* Live 分数最终确认弹窗（居中） */}
        <ScoreConfirmModal />

        {/* 换牌面板 */}
        <MulliganPanel isOpen={mulliganPanelOpen} />

        {/* 拖拽覆盖层 - 显示正在拖拽的卡牌 */}
        <DragOverlay>
          {activeCard && (
            <Card
              cardData={activeCard.data as AnyCardData}
              instanceId={activeCard.instanceId}
              imagePath={getCardImagePath(activeCard.data.cardCode)}
              size="sm"
              faceUp={true}
              showHover={false}
            />
          )}
        </DragOverlay>
      </div>
    </DndContext>
  );
});

export default GameBoard;

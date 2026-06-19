/**
 * GameSetupPage - 游戏准备页面
 * Step 0: 选择游戏模式（调试模式 / 对墙打模式）
 * Step 1: 选择卡组（调试模式选 2 副，对墙打模式选 1 副）
 * Step 2: 确认并开始游戏
 */

import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeft,
  Bot,
  Bug,
  Check,
  ChevronLeft,
  ChevronRight,
  Gamepad2,
  Globe2,
  Layers3,
  Play,
  Star,
  Target,
  Users,
  UserRound,
  WandSparkles,
  Zap,
} from 'lucide-react';
import { useDeckStore } from '@/store/deckStore';
import { useGameStore } from '@/store/gameStore';
import {
  DeckSelector,
  getDeckPointTextClass,
  PageHeader,
  ThemeToggle,
  type DeckDisplayItem,
} from '@/components/common';
import { DECK_POINT_LIMIT } from '@game/domain/rules/deck-construction';
import { DeckLoader } from '@game/domain/card-data/deck-loader';
import { CardDataRegistry } from '@game/domain/card-data/loader';
import { loadSolitaireOpponentDeck } from '@game/application/solitaire-deck';
import type { DeckConfig } from '@game/application/game-service';
import { GameMode } from '@game/shared/types/enums';
import defaultOpponentDeckYaml from '../../../../assets/decks/缪预组.yaml?raw';
import {
  createDeckRecordCardTypeResolver,
  deckRecordToConfig,
  isDeckRecordValidForCurrentCardPool,
} from '@/lib/deckRecordUtils';
import { useAuthStore } from '@/store/authStore';
import { isApiConfigured } from '@/lib/apiClient';
import { createSolitaireMatch } from '@/lib/solitaireMatchClient';

type SetupStep = 0 | 1 | 2 | 3;

interface GameSetupPageProps {
  onBack: () => void;
  onGameStart: () => void;
  onNavigateToOnlineRoom: () => void;
}

export function GameSetupPage({ onBack, onGameStart, onNavigateToOnlineRoom }: GameSetupPageProps) {
  const [currentStep, setCurrentStep] = useState<SetupStep>(0);
  const [gameMode, setLocalGameMode] = useState<GameMode>(GameMode.DEBUG);
  const [selectedP1Deck, setSelectedP1Deck] = useState<DeckDisplayItem | null>(null);
  const [selectedP2Deck, setSelectedP2Deck] = useState<DeckDisplayItem | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isDebugMode = gameMode === GameMode.DEBUG;
  const maxStep: SetupStep = isDebugMode ? 3 : 2;
  const offlineMode = useAuthStore((s) => s.offlineMode);
  const authenticatedUser = useAuthStore((s) => s.user);
  const canUseOnlineRoom = !offlineMode && isApiConfigured;
  const canUseRecordedSolitaire = canUseOnlineRoom && authenticatedUser !== null;

  // Deck store
  const cloudDecks = useDeckStore((s) => s.cloudDecks);
  const isLoadingCloud = useDeckStore((s) => s.isLoadingCloud);
  const cloudError = useDeckStore((s) => s.cloudError);
  const fetchCloudDecks = useDeckStore((s) => s.fetchCloudDecks);

  // Game store
  const initializeGame = useGameStore((s) => s.initializeGame);
  const createGame = useGameStore((s) => s.createGame);
  const connectRemoteSession = useGameStore((s) => s.connectRemoteSession);
  const applyRemoteSnapshot = useGameStore((s) => s.applyRemoteSnapshot);
  const cardDataRegistry = useGameStore((s) => s.cardDataRegistry);
  const setGameMode = useGameStore((s) => s.setGameMode);

  // 加载云端卡组
  useEffect(() => {
    fetchCloudDecks();
  }, [fetchCloudDecks]);

  // 只显示有效的卡组
  const validDecks = useMemo(
    () => cloudDecks.filter((deck) => isDeckRecordValidForCurrentCardPool(deck, cardDataRegistry)),
    [cardDataRegistry, cloudDecks]
  );

  // 处理选择 P1 卡组
  const handleSelectP1 = (deck: DeckDisplayItem) => {
    if (!deck.isValid) return;
    setSelectedP1Deck(deck);
  };

  // 处理选择 P2 卡组（仅调试模式）
  const handleSelectP2 = (deck: DeckDisplayItem) => {
    if (!deck.isValid) return;
    setSelectedP2Deck(deck);
  };

  // 选择模式
  const handleSelectMode = (mode: GameMode) => {
    setLocalGameMode(mode);
    // 切换模式时重置卡组选择
    setSelectedP1Deck(null);
    setSelectedP2Deck(null);
  };

  // 下一步
  const handleNext = () => {
    if (currentStep === 0) {
      setCurrentStep(1);
    } else if (currentStep === 1) {
      if (gameMode === GameMode.DEBUG && selectedP1Deck) {
        setCurrentStep(2);
      } else if (gameMode === GameMode.SOLITAIRE && selectedP1Deck) {
        setCurrentStep(2);
      }
    } else if (currentStep === 2 && gameMode === GameMode.DEBUG && selectedP2Deck) {
      setCurrentStep(3);
    }
  };

  // 上一步
  const handlePrev = () => {
    if (currentStep === 1) {
      setCurrentStep(0);
    } else if (currentStep === 2) {
      setCurrentStep(1);
    } else if (currentStep === 3) {
      setCurrentStep(2);
    }
  };

  // 是否可以进入下一步
  const canProceed = () => {
    if (currentStep === 0) return gameMode !== undefined;
    if (currentStep === 1) return selectedP1Deck !== null;
    if (currentStep === 2 && gameMode === GameMode.DEBUG) return selectedP2Deck !== null;
    return false;
  };

  // 开始游戏
  const handleStartGame = async () => {
    if (!selectedP1Deck) return;

    setIsStarting(true);
    setError(null);

    try {
      if (gameMode === GameMode.SOLITAIRE && canUseRecordedSolitaire) {
        const deckId = selectedP1Deck.cloudDeck?.id;
        if (!deckId) {
          throw new Error('卡组数据无效');
        }
        const created = await createSolitaireMatch(deckId);
        connectRemoteSession({
          source: 'SOLITAIRE',
          matchId: created.matchId,
          seat: created.snapshot.seat,
          playerId: created.snapshot.playerId,
        });
        await applyRemoteSnapshot(created.snapshot);
        onGameStart();
        return;
      }

      // 创建 CardDataRegistry 和 DeckLoader
      const registry = new CardDataRegistry();
      registry.load(Array.from(cardDataRegistry.values()));
      const loader = new DeckLoader(registry);

      // 加载玩家 1 卡组
      const p1CloudDeck = selectedP1Deck.cloudDeck;
      if (!p1CloudDeck) {
        throw new Error('卡组数据无效');
      }

      const resolveDeckRecordCardType = createDeckRecordCardTypeResolver(cardDataRegistry);
      const p1Config = deckRecordToConfig(p1CloudDeck, {
        resolveCardType: resolveDeckRecordCardType,
      });
      const p1Result = loader.loadFromConfig(p1Config);

      if (!p1Result.success || !p1Result.deck) {
        throw new Error(`卡组加载失败: ${p1Result.errors?.join(', ')}`);
      }

      let p2DeckConfig: DeckConfig;

      if (gameMode === GameMode.SOLITAIRE) {
        // 对墙打模式：加载默认对手卡组
        p2DeckConfig = loadSolitaireOpponentDeck(defaultOpponentDeckYaml, registry);
      } else {
        // 调试模式：加载玩家 2 卡组
        if (!selectedP2Deck?.cloudDeck) {
          throw new Error('Player 2 卡组数据无效');
        }
        const p2Config = deckRecordToConfig(selectedP2Deck.cloudDeck, {
          resolveCardType: resolveDeckRecordCardType,
        });
        const p2Result = loader.loadFromConfig(p2Config);
        if (!p2Result.success || !p2Result.deck) {
          throw new Error(`P2 卡组加载失败: ${p2Result.errors?.join(', ')}`);
        }
        p2DeckConfig = {
          mainDeck: [...p2Result.deck.mainDeck],
          energyDeck: [...p2Result.deck.energyDeck],
        };
      }

      // 设置游戏模式
      setGameMode(gameMode);

      // 创建游戏会话
      const p2Name =
        gameMode === GameMode.SOLITAIRE
          ? '对手 (AI)'
          : (selectedP2Deck?.cloudDeck?.name ?? 'Player 2');
      createGame(`game-${Date.now()}`, 'player-1', p1Config.player_name, 'player-2', p2Name);

      // 初始化游戏
      initializeGame(
        { mainDeck: p1Result.deck.mainDeck, energyDeck: p1Result.deck.energyDeck },
        p2DeckConfig
      );

      // 触发游戏开始回调
      onGameStart();
    } catch (err) {
      setError(err instanceof Error ? err.message : '启动游戏失败');
      setIsStarting(false);
    }
  };

  // 步骤指示器
  const renderStepIndicator = () => {
    const steps = gameMode === GameMode.SOLITAIRE ? [0, 1, 2] : [0, 1, 2, 3];
    const labels =
      gameMode === GameMode.SOLITAIRE ? ['模式', '卡组', '确认'] : ['模式', 'P1', 'P2', '确认'];
    return (
      <div className="mx-auto mb-4 w-full max-w-2xl sm:mb-5">
        <ol
          className="grid gap-1 rounded-lg border border-[var(--border-subtle)] bg-[color:color-mix(in_srgb,var(--bg-overlay)_58%,transparent)] p-1"
          style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}
          aria-label="游戏准备步骤"
        >
          {steps.map((step, idx) => {
            const isActive = currentStep === step;
            const isDone = currentStep > step;

            return (
              <li key={step} className="min-w-0">
                <div
                  className={`relative flex min-h-9 items-center justify-center gap-1.5 rounded-md px-2 text-center transition-colors sm:justify-start sm:px-3 ${
                    isActive
                      ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-[var(--shadow-sm)]'
                      : isDone
                        ? 'text-[var(--semantic-success)]'
                        : 'text-[var(--text-muted)]'
                  }`}
                  aria-current={isActive ? 'step' : undefined}
                >
                  {isActive && (
                    <span className="absolute inset-y-1 left-1 hidden w-0.5 rounded-full bg-[var(--accent-primary)] sm:block" />
                  )}
                  <span
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-[11px] font-bold ${
                      isActive
                        ? 'bg-[color:color-mix(in_srgb,var(--accent-primary)_15%,transparent)] text-[var(--accent-primary)]'
                        : isDone
                          ? 'bg-[color:color-mix(in_srgb,var(--semantic-success)_13%,transparent)]'
                          : 'bg-[color:color-mix(in_srgb,var(--bg-surface)_72%,transparent)]'
                    }`}
                  >
                    {isDone ? <Check size={12} /> : idx + 1}
                  </span>
                  <span className="truncate text-xs font-semibold sm:text-sm">{labels[idx]}</span>
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    );
  };

  // 步骤标题
  const getStepTitle = () => {
    switch (currentStep) {
      case 0:
        return '选择游戏模式';
      case 1:
        return gameMode === GameMode.SOLITAIRE ? '选择己方卡组' : '选择 Player 1 的卡组';
      case 2:
        return gameMode === GameMode.SOLITAIRE ? '确认并开始游戏' : '选择 Player 2 的卡组';
      case 3:
        return '确认并开始游戏';
    }
  };

  return (
    <div className="app-shell flex min-h-screen flex-col">
      <PageHeader
        title="游戏准备"
        icon={<Gamepad2 size={20} />}
        left={
          <button
            type="button"
            onClick={onBack}
            className="button-icon"
            title="返回首页"
            aria-label="返回首页"
          >
            <ArrowLeft size={16} />
          </button>
        }
        right={<ThemeToggle />}
        className="sm:px-6"
      />

      <main className="relative z-10 flex flex-1 flex-col overflow-hidden px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-5 sm:px-6 sm:pb-[calc(env(safe-area-inset-bottom)+1.5rem)] sm:pt-6">
        {renderStepIndicator()}

        <motion.h2
          key={currentStep}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-5 text-center text-xl font-bold text-[var(--text-primary)] sm:mb-6 sm:text-2xl"
        >
          {getStepTitle()}
        </motion.h2>

        <div className="flex-1 min-h-0 relative">
          <AnimatePresence mode="wait">
            {currentStep === 0 && (
              <motion.div
                key="step0"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                className="absolute inset-0 flex items-start justify-center overflow-y-auto pb-24 sm:items-center sm:pb-0"
              >
                <div className="grid w-full max-w-4xl gap-4 md:grid-cols-3 md:gap-5">
                  <button
                    onClick={canUseOnlineRoom ? onNavigateToOnlineRoom : undefined}
                    disabled={!canUseOnlineRoom}
                    className={`surface-panel group p-4 text-left transition-all duration-300 sm:p-6 ${
                      canUseOnlineRoom
                        ? 'hover:border-[color:color-mix(in_srgb,var(--semantic-info)_38%,var(--border-default))] hover:bg-[color:color-mix(in_srgb,var(--semantic-info)_8%,var(--bg-surface))]'
                        : 'cursor-not-allowed opacity-55'
                    }`}
                  >
                    <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--border-default)] bg-[var(--bg-overlay)] text-[var(--semantic-info)] sm:mb-4 sm:h-14 sm:w-14 sm:rounded-2xl">
                      <Globe2 size={22} />
                    </div>
                    <h3 className="mb-1.5 text-lg font-bold text-[var(--text-primary)] sm:mb-2 sm:text-xl">
                      联机模式
                    </h3>
                    <p className="text-sm leading-relaxed text-[var(--text-secondary)]">
                      创建或加入房间，使用云端卡组进行正式对战。
                    </p>
                    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-[var(--text-muted)] sm:mt-4">
                      <Users size={12} />
                      <span>房间对战</span>
                      <span>·</span>
                      <Globe2 size={12} />
                      <span>{canUseOnlineRoom ? '进入联机' : '连接后可用'}</span>
                    </div>
                  </button>

                  <button
                    onClick={() => handleSelectMode(GameMode.DEBUG)}
                    className={`surface-panel group p-4 text-left transition-all duration-300 sm:p-6 ${
                      gameMode === GameMode.DEBUG
                        ? 'border-[color:color-mix(in_srgb,var(--accent-primary)_45%,transparent)] bg-[color:color-mix(in_srgb,var(--accent-primary)_12%,var(--bg-surface))] shadow-[var(--shadow-glow)]'
                        : 'hover:border-[var(--border-default)] hover:bg-[var(--bg-overlay)]'
                    }`}
                  >
                    <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--border-default)] bg-[var(--bg-overlay)] text-[var(--accent-primary)] sm:mb-4 sm:h-14 sm:w-14 sm:rounded-2xl">
                      <Bug size={22} />
                    </div>
                    <h3 className="mb-1.5 text-lg font-bold text-[var(--text-primary)] sm:mb-2 sm:text-xl">
                      调试模式
                    </h3>
                    <p className="text-sm leading-relaxed text-[var(--text-secondary)]">
                      为双方分别选择卡组，进入双人对战。
                    </p>
                    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-[var(--text-muted)] sm:mt-4">
                      <Users size={12} />
                      <span>2 人</span>
                      <span>·</span>
                      <Layers3 size={12} />
                      <span>选 2 副卡组</span>
                    </div>
                  </button>

                  <button
                    onClick={() => handleSelectMode(GameMode.SOLITAIRE)}
                    className={`surface-panel group p-4 text-left transition-all duration-300 sm:p-6 ${
                      gameMode === GameMode.SOLITAIRE
                        ? 'border-[color:color-mix(in_srgb,var(--heart-green)_40%,transparent)] bg-[color:color-mix(in_srgb,var(--heart-green)_10%,var(--bg-surface))] shadow-[0_0_18px_rgba(52,211,153,0.18)]'
                        : 'hover:border-[var(--border-default)] hover:bg-[var(--bg-overlay)]'
                    }`}
                  >
                    <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--border-default)] bg-[var(--bg-overlay)] text-[var(--heart-green)] sm:mb-4 sm:h-14 sm:w-14 sm:rounded-2xl">
                      <Target size={22} />
                    </div>
                    <h3 className="mb-1.5 text-lg font-bold text-[var(--text-primary)] sm:mb-2 sm:text-xl">
                      对墙打模式
                    </h3>
                    <p className="text-sm leading-relaxed text-[var(--text-secondary)]">
                      只选择己方卡组，快速开始单人测试。
                    </p>
                    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-[var(--text-muted)] sm:mt-4">
                      <UserRound size={12} />
                      <span>1 人</span>
                      <span>·</span>
                      <Layers3 size={12} />
                      <span>选 1 副卡组</span>
                    </div>
                  </button>
                </div>
              </motion.div>
            )}

            {/* Step 1: Select P1 Deck */}
            {currentStep === 1 && (
              <motion.div
                key="step1"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                className="absolute inset-0 flex justify-center"
              >
                <div className="w-full max-w-2xl h-full">
                  <DeckSelector
                    cloudDecks={validDecks}
                    selectedId={selectedP1Deck?.id}
                    onSelect={handleSelectP1}
                    isLoading={isLoadingCloud}
                    error={cloudError}
                    onRefresh={fetchCloudDecks}
                    title={gameMode === GameMode.SOLITAIRE ? '己方卡组' : 'Player 1 卡组'}
                    emptyText="没有可用的卡组，请先创建一个完整的卡组"
                  />
                </div>
              </motion.div>
            )}

            {/* Step 2: Select P2 Deck (debug only) */}
            {currentStep === 2 && gameMode === GameMode.DEBUG && (
              <motion.div
                key="step2-p2"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                className="absolute inset-0 flex justify-center"
              >
                <div className="w-full max-w-2xl h-full">
                  <DeckSelector
                    cloudDecks={validDecks}
                    selectedId={selectedP2Deck?.id}
                    onSelect={handleSelectP2}
                    isLoading={isLoadingCloud}
                    error={cloudError}
                    onRefresh={fetchCloudDecks}
                    title="Player 2 卡组"
                    emptyText="没有可用的卡组，请先创建一个完整的卡组"
                  />
                </div>
              </motion.div>
            )}

            {/* Confirm */}
            {((currentStep === 2 && gameMode === GameMode.SOLITAIRE) ||
              (currentStep === 3 && gameMode === GameMode.DEBUG)) && (
              <motion.div
                key="step-confirm"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                className="absolute inset-0 flex justify-center items-start sm:items-center"
              >
                <div className="flex w-full max-w-2xl flex-col items-center">
                  <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-[var(--border-default)] bg-[var(--bg-overlay)] px-4 py-2 text-sm font-medium text-[var(--text-primary)]">
                    {gameMode === GameMode.SOLITAIRE ? (
                      <Target size={16} className="text-[var(--heart-green)]" />
                    ) : (
                      <Bug size={16} className="text-[var(--accent-primary)]" />
                    )}
                    {gameMode === GameMode.SOLITAIRE ? '对墙打模式' : '调试模式'}
                  </div>

                  <div
                    className={`mb-8 grid w-full gap-4 sm:gap-6 ${gameMode === GameMode.SOLITAIRE ? 'grid-cols-1 max-w-md mx-auto' : 'md:grid-cols-2'}`}
                  >
                    <div className="surface-panel p-5 sm:p-6">
                      <div className="flex items-center gap-3 mb-4">
                        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[color:color-mix(in_srgb,var(--accent-primary)_12%,transparent)] text-[var(--accent-primary)]">
                          <UserRound size={22} />
                        </div>
                        <div className="min-w-0">
                          <div className="text-xs uppercase tracking-wider text-[var(--text-muted)]">
                            {gameMode === GameMode.SOLITAIRE ? '己方' : 'Player 1'}
                          </div>
                          <div className="truncate text-lg font-bold text-[var(--text-primary)]">
                            {selectedP1Deck?.name || '未选择'}
                          </div>
                        </div>
                      </div>
                      {selectedP1Deck && (
                        <div className="flex flex-wrap items-center gap-3 text-sm text-[var(--text-secondary)]">
                          <span className="inline-flex items-center gap-1">
                            <Users size={14} />
                            {selectedP1Deck.memberCount}/48
                          </span>
                          <span className="inline-flex items-center gap-1">
                            <Layers3 size={14} />
                            {selectedP1Deck.liveCount}/12
                          </span>
                          <span className="inline-flex items-center gap-1">
                            <Zap size={14} />
                            {selectedP1Deck.energyCount}/12
                          </span>
                          <span
                            className={`inline-flex items-center gap-1 ${getDeckPointTextClass(selectedP1Deck.pointTotal)}`}
                          >
                            <Star size={14} />
                            {selectedP1Deck.pointTotal}/{DECK_POINT_LIMIT}pt
                          </span>
                        </div>
                      )}
                    </div>

                    {gameMode === GameMode.DEBUG && (
                      <div className="surface-panel p-5 sm:p-6">
                        <div className="flex items-center gap-3 mb-4">
                          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[color:color-mix(in_srgb,var(--accent-secondary)_12%,transparent)] text-[var(--accent-secondary)]">
                            <UserRound size={22} />
                          </div>
                          <div className="min-w-0">
                            <div className="text-xs uppercase tracking-wider text-[var(--text-muted)]">
                              Player 2
                            </div>
                            <div className="truncate text-lg font-bold text-[var(--text-primary)]">
                              {selectedP2Deck?.name || '未选择'}
                            </div>
                          </div>
                        </div>
                        {selectedP2Deck && (
                          <div className="flex flex-wrap items-center gap-3 text-sm text-[var(--text-secondary)]">
                            <span className="inline-flex items-center gap-1">
                              <Users size={14} />
                              {selectedP2Deck.memberCount}/48
                            </span>
                            <span className="inline-flex items-center gap-1">
                              <Layers3 size={14} />
                              {selectedP2Deck.liveCount}/12
                            </span>
                            <span className="inline-flex items-center gap-1">
                              <Zap size={14} />
                              {selectedP2Deck.energyCount}/12
                            </span>
                            <span
                              className={`inline-flex items-center gap-1 ${getDeckPointTextClass(selectedP2Deck.pointTotal)}`}
                            >
                              <Star size={14} />
                              {selectedP2Deck.pointTotal}/{DECK_POINT_LIMIT}pt
                            </span>
                          </div>
                        )}
                      </div>
                    )}

                    {gameMode === GameMode.SOLITAIRE && (
                      <div className="surface-panel flex items-start gap-3 p-4">
                        <Bot size={22} className="mt-0.5 shrink-0 text-[var(--text-muted)]" />
                        <div className="min-w-0 text-sm text-[var(--text-secondary)]">
                          <div>对手卡组已自动准备完成</div>
                          <div
                            className={`mt-1 text-xs ${
                              canUseRecordedSolitaire
                                ? 'text-[var(--semantic-success)]'
                                : 'text-[var(--text-muted)]'
                            }`}
                          >
                            {canUseRecordedSolitaire
                              ? '在线记录：本局会保存到历史并可复盘'
                              : '本地模式：本局不会保存历史'}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  {error && (
                    <div className="mb-6 w-full rounded-xl border border-[color:color-mix(in_srgb,var(--semantic-error)_35%,transparent)] bg-[color:color-mix(in_srgb,var(--semantic-error)_12%,transparent)] p-4">
                      <div className="flex items-center gap-2 text-sm text-[var(--semantic-error)]">
                        <WandSparkles size={16} />
                        <span>{error}</span>
                      </div>
                    </div>
                  )}

                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={handleStartGame}
                    disabled={isStarting}
                    className={`button-gold w-full px-8 py-4 text-base font-bold sm:w-auto sm:px-12 sm:text-lg ${isStarting ? 'cursor-not-allowed opacity-50' : ''}`}
                  >
                    {isStarting ? (
                      <span className="flex items-center gap-2">
                        <WandSparkles size={18} className="animate-spin" />
                        <span>准备中...</span>
                      </span>
                    ) : (
                      <span className="flex items-center gap-2">
                        <Play size={18} />
                        <span>开始游戏！</span>
                      </span>
                    )}
                  </motion.button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="sticky bottom-0 mt-5 w-full max-w-2xl self-center rounded-[20px] border border-[var(--border-default)] bg-[color:color-mix(in_srgb,var(--bg-frosted)_94%,transparent)] p-3 shadow-[var(--shadow-md)] backdrop-blur-xl sm:static sm:mt-6 sm:rounded-none sm:border-0 sm:bg-transparent sm:p-0 sm:shadow-none">
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
            <button
              onClick={handlePrev}
              disabled={currentStep === 0}
              className={`button-ghost inline-flex min-h-11 items-center justify-center gap-2 px-6 py-2 font-medium ${
                currentStep === 0
                  ? 'cursor-not-allowed opacity-30'
                  : 'border border-[var(--border-default)]'
              }`}
            >
              <ChevronLeft size={16} />
              上一步
            </button>

            {currentStep < maxStep && (
              <button
                onClick={handleNext}
                disabled={!canProceed()}
                className={`button-primary inline-flex min-h-11 items-center justify-center gap-2 px-6 py-2 font-medium ${!canProceed() ? 'cursor-not-allowed opacity-50' : ''}`}
              >
                下一步
                <ChevronRight size={16} />
              </button>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

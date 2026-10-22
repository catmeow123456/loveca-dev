import { useTextPresentation } from '@/lib/appPresentation';
/**
 * GameSetupPage - 对墙打与双人调试的卡组准备
 * Step 1: 选择卡组（调试模式选 2 副，对墙打模式选 1 副）
 * Step 2: 确认并开始对局
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Bug,
  Check,
  ChevronLeft,
  ChevronRight,
  History,
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
  ActionButton,
  DeckSelector,
  getDeckPointTextClass,
  Panel,
  ProductFrame,
  type DeckDisplayItem,
  type ProductNavigationHandlers,
} from '@/components/common';
import { DeckLoader } from '@game/domain/card-data/deck-loader';
import { CardDataRegistry } from '@game/domain/card-data/loader';
import { loadSolitaireOpponentDeck } from '@game/application/solitaire-deck';
import type { DeckConfig } from '@game/application/game-service';
import { GameMode } from '@game/shared/types/enums';
import defaultOpponentDeckYaml from '../../../../assets/decks/缪预组.yaml?raw';
import {
  createDeckRecordCardTypeResolver,
  deckRecordToConfig,
  isDeckConfigValidForCurrentCardPool,
  isDeckRecordValidForCurrentCardPool,
} from '@/lib/deckRecordUtils';
import { buildDeckDisplayItems } from '@/lib/deckDisplay';
import {
  choosePreferredDeck,
  DECK_SELECTION_PREFERENCE_KEYS,
  readLastUsedDeckId,
  writeLastUsedDeckId,
} from '@/lib/deckSelectionPreferences';
import { useAuthStore } from '@/store/authStore';
import { isApiConfigured } from '@/lib/apiClient';
import { createSolitaireMatch } from '@/lib/solitaireMatchClient';
import { writeStoredSolitaireMatchId } from '@/lib/solitaireMatchRecovery';
import { cn } from '@/lib/utils';
import { useDeckPointTableRules } from '@/hooks/useDeckPointTable';

type SetupStep = 1 | 2 | 3;
type SetupMode = GameMode.DEBUG | GameMode.SOLITAIRE;

interface GameSetupPageProps {
  mode: SetupMode;
  onModeChange: (mode: SetupMode) => void;
  navigation: ProductNavigationHandlers;
  headerActions: ReactNode;
  mobileMenuActions: ReactNode;
  onBack: () => void;
  onGameStart: () => void;
  onManageDecks: () => void;
}

function createLocalGameId(): string {
  return `game-${Date.now()}`;
}

export function GameSetupPage({
  mode: gameMode,
  onModeChange,
  navigation,
  headerActions,
  mobileMenuActions,
  onBack,
  onGameStart,
  onManageDecks,
}: GameSetupPageProps) {
  const textOnly = useTextPresentation();
  const [currentStep, setCurrentStep] = useState<SetupStep>(1);
  const [selectedP1DeckState, setSelectedP1Deck] = useState<DeckDisplayItem | null>(null);
  const [selectedP2DeckState, setSelectedP2Deck] = useState<DeckDisplayItem | null>(null);
  const [hasManualSelectedP1Deck, setHasManualSelectedP1Deck] = useState(false);
  const [hasManualSelectedP2Deck, setHasManualSelectedP2Deck] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isDebugMode = gameMode === GameMode.DEBUG;
  const maxStep: SetupStep = isDebugMode ? 3 : 2;
  const isConfirmStep =
    (currentStep === 2 && gameMode === GameMode.SOLITAIRE) ||
    (currentStep === 3 && gameMode === GameMode.DEBUG);
  const offlineMode = useAuthStore((s) => s.offlineMode);
  const authenticatedUser = useAuthStore((s) => s.user);
  const canUseRecordedSolitaire = !offlineMode && isApiConfigured && authenticatedUser !== null;
  const pointTable = useDeckPointTableRules();

  // Deck store
  const cloudDecks = useDeckStore((s) => s.cloudDecks);
  const cloudDeckLoadState = useDeckStore((s) => s.cloudDeckLoadState);
  const cloudError = useDeckStore((s) => s.cloudError);
  const ensureCloudDecks = useDeckStore((s) => s.ensureCloudDecks);
  const refreshCloudDecks = useDeckStore((s) => s.refreshCloudDecks);
  const isLoadingCloud = cloudDeckLoadState === 'LOADING';
  const isRefreshingCloud = cloudDeckLoadState === 'REFRESHING';
  const localDecks = useDeckStore((s) => s.localDecks);

  // Game store
  const initializeGame = useGameStore((s) => s.initializeGame);
  const createGame = useGameStore((s) => s.createGame);
  const connectRemoteSession = useGameStore((s) => s.connectRemoteSession);
  const applyRemoteSnapshot = useGameStore((s) => s.applyRemoteSnapshot);
  const cardDataRegistry = useGameStore((s) => s.cardDataRegistry);
  const setGameMode = useGameStore((s) => s.setGameMode);

  // 加载云端卡组
  useEffect(() => {
    void ensureCloudDecks();
  }, [ensureCloudDecks]);

  // 只显示有效的卡组
  const validDecks = useMemo(
    () =>
      cloudDecks.filter((deck) =>
        isDeckRecordValidForCurrentCardPool(deck, cardDataRegistry, pointTable)
      ),
    [cardDataRegistry, cloudDecks, pointTable]
  );
  const resolveDeckRecordCardType = useMemo(
    () => createDeckRecordCardTypeResolver(cardDataRegistry),
    [cardDataRegistry]
  );
  const deckDisplayItems = useMemo(
    () =>
      buildDeckDisplayItems({
        cloudDecks: validDecks,
        localDecks: offlineMode ? localDecks : [],
        resolveDeckRecordCardType,
        pointTable,
        validateLocalDeck: (deck) =>
          isDeckConfigValidForCurrentCardPool(deck, cardDataRegistry, pointTable),
      }),
    [cardDataRegistry, localDecks, offlineMode, pointTable, resolveDeckRecordCardType, validDecks]
  );
  const p1PreferenceKey =
    gameMode === GameMode.DEBUG
      ? DECK_SELECTION_PREFERENCE_KEYS.localDebugPlayer1
      : DECK_SELECTION_PREFERENCE_KEYS.solitaire;
  const p1LastUsedDeckId = useMemo(() => readLastUsedDeckId(p1PreferenceKey), [p1PreferenceKey]);
  const p2LastUsedDeckId = useMemo(
    () => readLastUsedDeckId(DECK_SELECTION_PREFERENCE_KEYS.localDebugPlayer2),
    []
  );
  const p1PreferredDeck = useMemo(
    () => choosePreferredDeck(deckDisplayItems, p1LastUsedDeckId),
    [deckDisplayItems, p1LastUsedDeckId]
  );
  const p2PreferredDeck = useMemo(
    () => choosePreferredDeck(deckDisplayItems, p2LastUsedDeckId),
    [deckDisplayItems, p2LastUsedDeckId]
  );
  const selectedP1Deck = useMemo(() => {
    const refreshedDeck = selectedP1DeckState
      ? (deckDisplayItems.find((deck) => deck.id === selectedP1DeckState.id && deck.isValid) ??
        null)
      : null;
    if (refreshedDeck) {
      return refreshedDeck;
    }
    return !hasManualSelectedP1Deck ? p1PreferredDeck.deck : null;
  }, [deckDisplayItems, hasManualSelectedP1Deck, p1PreferredDeck.deck, selectedP1DeckState]);
  const selectedP2Deck = useMemo(() => {
    const refreshedDeck = selectedP2DeckState
      ? (deckDisplayItems.find((deck) => deck.id === selectedP2DeckState.id && deck.isValid) ??
        null)
      : null;
    if (refreshedDeck) {
      return refreshedDeck;
    }
    return gameMode === GameMode.DEBUG && !hasManualSelectedP2Deck ? p2PreferredDeck.deck : null;
  }, [
    deckDisplayItems,
    gameMode,
    hasManualSelectedP2Deck,
    p2PreferredDeck.deck,
    selectedP2DeckState,
  ]);

  // 处理选择 P1 卡组
  const handleSelectP1 = (deck: DeckDisplayItem) => {
    if (!deck.isValid) return;
    setHasManualSelectedP1Deck(true);
    setSelectedP1Deck(deck);
  };

  // 处理选择 P2 卡组（仅调试模式）
  const handleSelectP2 = (deck: DeckDisplayItem) => {
    if (!deck.isValid) return;
    setHasManualSelectedP2Deck(true);
    setSelectedP2Deck(deck);
  };

  // 下一步
  const handleNext = () => {
    if (currentStep === 1) {
      if (selectedP1Deck) setCurrentStep(2);
    } else if (currentStep === 2 && gameMode === GameMode.DEBUG && selectedP2Deck) {
      setCurrentStep(3);
    }
  };

  // 上一步
  const handlePrev = () => {
    if (currentStep === 1) {
      onBack();
    } else if (currentStep === 2) {
      setCurrentStep(1);
    } else if (currentStep === 3) {
      setCurrentStep(2);
    }
  };

  // 是否可以进入下一步
  const canProceed = () => {
    if (currentStep === 1) return selectedP1Deck !== null;
    if (currentStep === 2 && gameMode === GameMode.DEBUG) return selectedP2Deck !== null;
    return false;
  };

  // 开始对局
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
        writeStoredSolitaireMatchId(created.matchId);
        connectRemoteSession({
          source: 'SOLITAIRE',
          matchId: created.matchId,
          seat: created.snapshot.seat,
          playerId: created.snapshot.playerId,
        });
        await applyRemoteSnapshot(created.snapshot);
        persistCurrentSetupDeckPreferences();
        onGameStart();
        return;
      }

      // 创建 CardDataRegistry 和 DeckLoader
      const registry = new CardDataRegistry();
      registry.load(Array.from(cardDataRegistry.values()));
      const loader = new DeckLoader(registry);

      // 加载玩家 1 卡组。离线会话直接读取浏览器本地配置，不经过云端 API。
      const p1Config = selectedP1Deck.localDeck
        ? structuredClone(selectedP1Deck.localDeck.config)
        : selectedP1Deck.cloudDeck
          ? deckRecordToConfig(selectedP1Deck.cloudDeck, {
              resolveCardType: resolveDeckRecordCardType,
            })
          : null;
      if (!p1Config) {
        throw new Error('卡组数据无效');
      }
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
        const p2Config = selectedP2Deck?.localDeck
          ? structuredClone(selectedP2Deck.localDeck.config)
          : selectedP2Deck?.cloudDeck
            ? deckRecordToConfig(selectedP2Deck.cloudDeck, {
                resolveCardType: resolveDeckRecordCardType,
              })
            : null;
        if (!p2Config) {
          throw new Error('Player 2 卡组数据无效');
        }
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
        gameMode === GameMode.SOLITAIRE ? '对手 (AI)' : (selectedP2Deck?.name ?? 'Player 2');
      createGame(createLocalGameId(), 'player-1', p1Config.player_name, 'player-2', p2Name);

      // 初始化游戏
      initializeGame(
        { mainDeck: p1Result.deck.mainDeck, energyDeck: p1Result.deck.energyDeck },
        p2DeckConfig
      );

      // 触发游戏开始回调
      persistCurrentSetupDeckPreferences();
      onGameStart();
    } catch (err) {
      setError(err instanceof Error ? err.message : '启动游戏失败');
      setIsStarting(false);
    }
  };

  function persistCurrentSetupDeckPreferences() {
    if (!selectedP1Deck) {
      return;
    }

    if (gameMode === GameMode.SOLITAIRE) {
      writeLastUsedDeckId(DECK_SELECTION_PREFERENCE_KEYS.solitaire, selectedP1Deck.id);
      return;
    }

    writeLastUsedDeckId(DECK_SELECTION_PREFERENCE_KEYS.localDebugPlayer1, selectedP1Deck.id);
    if (selectedP2Deck) {
      writeLastUsedDeckId(DECK_SELECTION_PREFERENCE_KEYS.localDebugPlayer2, selectedP2Deck.id);
    }
  }

  // 步骤指示器
  const renderStepIndicator = () => {
    const steps = isDebugMode ? [1, 2, 3] : [1, 2];
    const labels = isDebugMode ? ['P1', 'P2', '确认'] : ['卡组', '确认'];
    return (
      <div className="mx-auto mb-4 w-full max-w-2xl sm:mb-5">
        <ol
          className="grid gap-1 rounded-lg border border-[var(--border-subtle)] bg-[color:color-mix(in_srgb,var(--bg-overlay)_58%,transparent)] p-1"
          style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}
          aria-label="对局准备步骤"
        >
          {steps.map((step, idx) => {
            const isActive = currentStep === step;
            const isDone = currentStep > step;

            return (
              <li key={step} className="min-w-0">
                <div
                  className={`relative flex min-h-9 items-center justify-center gap-1.5 rounded-md px-2 text-center transition-colors sm:justify-start sm:px-3 ${
                    isActive
                      ? 'bg-[var(--bg-surface)] text-[var(--text-primary)]'
                      : isDone
                        ? 'text-[var(--semantic-success)]'
                        : 'text-[var(--text-muted)]'
                  }`}
                  aria-current={isActive ? 'step' : undefined}
                >
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
      case 1:
        return gameMode === GameMode.SOLITAIRE ? '选择己方卡组' : '选择 Player 1 的卡组';
      case 2:
        return gameMode === GameMode.SOLITAIRE ? '确认并开始对局' : '选择 Player 2 的卡组';
      case 3:
        return '确认并开始对局';
    }
  };

  const getNextButtonLabel = () => {
    if (currentStep === 1 && gameMode === GameMode.DEBUG) return '下一步：选择 P2 卡组';
    if (currentStep === 1 && gameMode === GameMode.SOLITAIRE) return '下一步：确认对局';
    if (currentStep === 2 && gameMode === GameMode.DEBUG) return '下一步：确认对局';
    return '下一步';
  };

  if (textOnly)
    return (
      <ProductFrame
        active="battle"
        navigation={navigation}
        actions={headerActions}
        mobileMenuActions={mobileMenuActions}
        title={isDebugMode ? '双人调试' : '对墙打'}
        backLabel="返回大厅"
        onBack={onBack}
      >
        <main className="excel-setup">
          <div role="group" aria-label="练习与调试模式">
            {(
              [
                [GameMode.SOLITAIRE, '对墙打'],
                [GameMode.DEBUG, '双人调试'],
              ] as const
            ).map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                aria-pressed={gameMode === mode}
                disabled={isStarting}
                onClick={() => onModeChange(mode)}
              >
                {label}
              </button>
            ))}
          </div>
          <h2>{getStepTitle()}</h2>
          <div className="excel-setup-body">
            {isConfirmStep ? (
              <section aria-label="对局确认">
                <p>己方卡组：{selectedP1Deck?.name}</p>
                {gameMode === GameMode.DEBUG && <p>对方卡组：{selectedP2Deck?.name}</p>}
                <p>
                  {gameMode === GameMode.SOLITAIRE && canUseRecordedSolitaire
                    ? '在线记录：本局会保存到历史并可复盘'
                    : '本地模拟：本局不会保存历史'}
                </p>
              </section>
            ) : (
              <DeckSelector
                cloudDecks={cloudDecks}
                localDecks={offlineMode ? localDecks : []}
                selectedId={currentStep === 1 ? selectedP1Deck?.id : selectedP2Deck?.id}
                onSelect={currentStep === 1 ? handleSelectP1 : handleSelectP2}
                isLoading={!offlineMode && isLoadingCloud}
                isRefreshing={!offlineMode && isRefreshingCloud}
                error={offlineMode ? null : cloudError}
                onRefresh={offlineMode ? undefined : refreshCloudDecks}
                title="可用卡组"
                emptyText={
                  offlineMode ? '还没有可用的本地卡组。先从示例卡组创建一副。' : '还没有可用卡组。'
                }
                emptyActionLabel={offlineMode ? '创建本地卡组' : '管理卡组'}
                onEmptyAction={onManageDecks}
                lastUsedDeckId={currentStep === 1 ? p1LastUsedDeckId : p2LastUsedDeckId}
              />
            )}
          </div>
          {error && <p role="alert">{error}</p>}
          <footer>
            <button onClick={handlePrev} disabled={isStarting}>
              {currentStep === 1 ? '取消准备' : '上一步'}
            </button>
            {currentStep < maxStep && (
              <button onClick={handleNext} disabled={!canProceed()}>
                {getNextButtonLabel()}
              </button>
            )}
            {isConfirmStep && (
              <button
                disabled={isStarting || !selectedP1Deck || (isDebugMode && !selectedP2Deck)}
                onClick={() => void handleStartGame()}
              >
                {isStarting ? '准备中…' : '开始对局'}
              </button>
            )}
          </footer>
        </main>
      </ProductFrame>
    );

  return (
    <ProductFrame
      active="battle"
      navigation={navigation}
      actions={headerActions}
      mobileMenuActions={mobileMenuActions}
      title={isDebugMode ? '双人调试' : '对墙打'}
      description={
        isDebugMode ? '选择双方卡组，在同一设备操作双方' : '选择己方卡组，练习完整对局流程'
      }
      backLabel="返回大厅"
      onBack={onBack}
    >
      <main className="relative z-10 flex flex-1 flex-col overflow-hidden px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-5 sm:px-6 sm:pb-[calc(env(safe-area-inset-bottom)+1.5rem)] sm:pt-6">
        <div className="mx-auto mb-4 flex gap-2" role="group" aria-label="练习与调试模式">
          {(
            [
              [GameMode.SOLITAIRE, '对墙打', Target],
              [GameMode.DEBUG, '双人调试', Bug],
            ] as const
          ).map(([mode, label, Icon]) => (
            <button
              key={mode}
              type="button"
              className={cn(
                'inline-flex min-h-11 items-center gap-2 rounded-lg px-4 text-sm',
                gameMode === mode ? 'button-secondary' : 'button-ghost'
              )}
              aria-pressed={gameMode === mode}
              disabled={isStarting}
              onClick={() => onModeChange(mode)}
            >
              <Icon size={16} aria-hidden="true" />
              {label}
            </button>
          ))}
        </div>
        {renderStepIndicator()}

        <motion.h2
          key={currentStep}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-5 text-center text-xl font-semibold text-[var(--text-primary)] sm:mb-6 sm:text-2xl"
        >
          {getStepTitle()}
        </motion.h2>

        <div className="flex-1 min-h-0 relative">
          <AnimatePresence mode="wait">
            {/* Step 1: Select P1 Deck */}
            {currentStep === 1 && (
              <motion.div
                key="step1"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                className="absolute inset-0 flex items-start justify-center"
              >
                <div
                  className={`w-full max-w-3xl ${
                    deckDisplayItems.length > 6 || (!offlineMode && isLoadingCloud) ? 'h-full' : ''
                  }`}
                >
                  <DeckSelector
                    cloudDecks={cloudDecks}
                    localDecks={offlineMode ? localDecks : []}
                    selectedId={selectedP1Deck?.id}
                    onSelect={handleSelectP1}
                    isLoading={!offlineMode && isLoadingCloud}
                    isRefreshing={!offlineMode && isRefreshingCloud}
                    error={offlineMode ? null : cloudError}
                    onRefresh={offlineMode ? undefined : refreshCloudDecks}
                    title="可用卡组"
                    emptyText={
                      offlineMode
                        ? '还没有可用的本地卡组。先从示例卡组创建一副。'
                        : '还没有可用卡组。'
                    }
                    emptyActionLabel={offlineMode ? '创建本地卡组' : '管理卡组'}
                    onEmptyAction={onManageDecks}
                    density="compact"
                    lastUsedDeckId={p1LastUsedDeckId}
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
                className="absolute inset-0 flex items-start justify-center"
              >
                <div
                  className={`w-full max-w-3xl ${
                    deckDisplayItems.length > 6 || (!offlineMode && isLoadingCloud) ? 'h-full' : ''
                  }`}
                >
                  <DeckSelector
                    cloudDecks={cloudDecks}
                    localDecks={offlineMode ? localDecks : []}
                    selectedId={selectedP2Deck?.id}
                    onSelect={handleSelectP2}
                    isLoading={!offlineMode && isLoadingCloud}
                    isRefreshing={!offlineMode && isRefreshingCloud}
                    error={offlineMode ? null : cloudError}
                    onRefresh={offlineMode ? undefined : refreshCloudDecks}
                    title="可用卡组"
                    emptyText={
                      offlineMode
                        ? '还没有可用的本地卡组。先从示例卡组创建一副。'
                        : '还没有可用卡组。'
                    }
                    emptyActionLabel={offlineMode ? '创建本地卡组' : '管理卡组'}
                    onEmptyAction={onManageDecks}
                    density="compact"
                    lastUsedDeckId={p2LastUsedDeckId}
                  />
                </div>
              </motion.div>
            )}

            {/* Confirm */}
            {isConfirmStep && (
              <motion.div
                key="step-confirm"
                role="region"
                aria-label="对局确认"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                className="absolute inset-0 flex overflow-y-auto overscroll-contain"
              >
                <div className="mx-auto my-auto flex w-full max-w-2xl shrink-0 flex-col items-center py-1">
                  <div className="mb-6 inline-flex items-center gap-2 rounded-md border border-[var(--border-default)] bg-[var(--bg-overlay)] px-4 py-2 text-sm font-medium text-[var(--text-primary)]">
                    {gameMode === GameMode.SOLITAIRE ? (
                      <Target size={16} className="text-[var(--semantic-success)]" />
                    ) : (
                      <Bug size={16} className="text-[var(--accent-primary)]" />
                    )}
                    {gameMode === GameMode.SOLITAIRE ? '对墙打模式' : '调试模式'}
                  </div>

                  <div
                    className={`mb-6 grid w-full gap-4 ${gameMode === GameMode.SOLITAIRE ? 'mx-auto max-w-md grid-cols-1' : 'md:grid-cols-2'}`}
                  >
                    <Panel>
                      <div className="flex items-center gap-3 mb-4">
                        <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-[color:color-mix(in_srgb,var(--accent-primary)_12%,transparent)] text-[var(--accent-primary)]">
                          <UserRound size={22} />
                        </div>
                        <div className="min-w-0">
                          <div className="text-xs text-[var(--text-muted)]">
                            {gameMode === GameMode.SOLITAIRE ? '己方' : 'Player 1'}
                          </div>
                          <div className="truncate text-lg font-semibold text-[var(--text-primary)]">
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
                            className={`inline-flex items-center gap-1 ${getDeckPointTextClass(selectedP1Deck.pointTotal, pointTable.pointLimit)}`}
                          >
                            <Star size={14} />
                            {selectedP1Deck.pointTotal}/{pointTable.pointLimit}pt
                          </span>
                        </div>
                      )}
                    </Panel>

                    {gameMode === GameMode.DEBUG && (
                      <Panel>
                        <div className="flex items-center gap-3 mb-4">
                          <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-[color:color-mix(in_srgb,var(--accent-secondary)_12%,transparent)] text-[var(--accent-secondary)]">
                            <UserRound size={22} />
                          </div>
                          <div className="min-w-0">
                            <div className="text-xs text-[var(--text-muted)]">Player 2</div>
                            <div className="truncate text-lg font-semibold text-[var(--text-primary)]">
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
                              className={`inline-flex items-center gap-1 ${getDeckPointTextClass(selectedP2Deck.pointTotal, pointTable.pointLimit)}`}
                            >
                              <Star size={14} />
                              {selectedP2Deck.pointTotal}/{pointTable.pointLimit}pt
                            </span>
                          </div>
                        )}
                      </Panel>
                    )}

                    {gameMode === GameMode.SOLITAIRE && (
                      <Panel padding="compact" className="flex items-start gap-3">
                        <History size={18} className="mt-0.5 shrink-0 text-[var(--text-muted)]" />
                        <div
                          className={`min-w-0 text-xs ${
                            canUseRecordedSolitaire
                              ? 'text-[var(--semantic-success)]'
                              : 'text-[var(--text-muted)]'
                          }`}
                        >
                          {canUseRecordedSolitaire
                            ? '在线记录：本局会保存到历史并可复盘'
                            : '本地模拟：本局不会保存历史'}
                        </div>
                      </Panel>
                    )}
                  </div>

                  {error && (
                    <div className="mb-5 w-full rounded-lg border border-[color:color-mix(in_srgb,var(--semantic-error)_35%,transparent)] bg-[color:color-mix(in_srgb,var(--semantic-error)_12%,transparent)] p-4">
                      <div className="flex items-center gap-2 text-sm text-[var(--semantic-error)]">
                        <WandSparkles size={16} />
                        <span>{error}</span>
                      </div>
                    </div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div
          className={cn(
            'sticky bottom-0 mt-5 w-full self-center rounded-lg border border-[var(--border-default)] bg-[color:color-mix(in_srgb,var(--bg-frosted)_94%,transparent)] p-3 shadow-[var(--shadow-md)] backdrop-blur-xl sm:static sm:mt-6 sm:rounded-none sm:border-0 sm:bg-transparent sm:p-0 sm:shadow-none',
            'max-w-2xl'
          )}
        >
          <div
            className={cn(
              'gap-2',
              isConfirmStep
                ? 'grid grid-cols-[auto_minmax(0,1fr)] sm:flex sm:justify-between'
                : 'flex flex-col-reverse sm:flex-row sm:justify-between'
            )}
          >
            <ActionButton
              variant="ghost"
              onClick={handlePrev}
              className="border border-[var(--border-default)] px-6"
            >
              <ChevronLeft size={16} />
              {currentStep === 1 ? '取消准备' : '上一步'}
            </ActionButton>

            {currentStep < maxStep && (
              <ActionButton
                onClick={handleNext}
                disabled={!canProceed()}
                className={cn('px-6', !canProceed() && 'cursor-not-allowed opacity-50')}
              >
                {getNextButtonLabel()}
                <ChevronRight size={16} />
              </ActionButton>
            )}

            {isConfirmStep && (
              <ActionButton
                onClick={() => void handleStartGame()}
                disabled={isStarting || !selectedP1Deck || (isDebugMode && !selectedP2Deck)}
                className={cn(
                  'min-w-0 px-4 text-base font-semibold sm:px-10',
                  isStarting && 'cursor-not-allowed opacity-50'
                )}
              >
                {isStarting ? (
                  <>
                    <WandSparkles size={18} className="animate-spin" />
                    准备中...
                  </>
                ) : (
                  <>
                    <Play size={18} />
                    开始对局
                  </>
                )}
              </ActionButton>
            )}
          </div>
        </div>
      </main>
    </ProductFrame>
  );
}

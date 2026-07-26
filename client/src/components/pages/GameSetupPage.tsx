/**
 * GameSetupPage - 游戏准备页面
 * Step 0: 选择游戏模式（公共牌桌 / 房间联机 / 对墙打 / 双人调试）
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
  Swords,
  Star,
  Target,
  Users,
  UserRound,
  WandSparkles,
  Zap,
  type LucideIcon,
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

type SetupStep = 0 | 1 | 2 | 3;
type SetupMode = 'PUBLIC_TABLE' | 'ONLINE' | GameMode.DEBUG | GameMode.SOLITAIRE;

interface GameSetupPageProps {
  onBack: () => void;
  onGameStart: () => void;
  onNavigateToOnlineRoom: () => void;
  onNavigateToPublicTable: () => void;
}

function createLocalGameId(): string {
  return `game-${Date.now()}`;
}

interface ModeChoiceProps {
  readonly mode: SetupMode;
  readonly title: string;
  readonly description: string;
  readonly icon: LucideIcon;
  readonly toneClass: string;
  readonly selected: boolean;
  readonly available: boolean;
  readonly featured?: boolean;
  readonly onSelect: (mode: SetupMode) => void;
}

function ModeChoice({
  mode,
  title,
  description,
  icon: Icon,
  toneClass,
  selected,
  available,
  featured = false,
  onSelect,
}: ModeChoiceProps) {
  return (
    <button
      type="button"
      onClick={() => onSelect(mode)}
      disabled={!available}
      aria-pressed={selected}
      className={cn(
        'group relative isolate flex w-full min-w-0 overflow-hidden border text-left outline-none transition duration-200 focus-visible:ring-2 focus-visible:ring-[var(--mode-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-deep)]',
        toneClass,
        featured
          ? 'min-h-[116px] items-center gap-4 rounded-[24px] p-5 sm:min-h-[132px] sm:px-7'
          : 'min-h-[108px] items-center gap-4 rounded-[20px] p-4 sm:min-h-[122px] sm:p-5',
        selected
          ? 'border-[color:color-mix(in_srgb,var(--mode-accent)_62%,var(--border-default))] bg-[color:color-mix(in_srgb,var(--mode-accent)_13%,var(--bg-surface))] shadow-[0_0_0_1px_color-mix(in_srgb,var(--mode-accent)_20%,transparent),var(--shadow-md)]'
          : 'border-[var(--border-subtle)] bg-[color:color-mix(in_srgb,var(--bg-surface)_76%,transparent)] hover:-translate-y-0.5 hover:border-[color:color-mix(in_srgb,var(--mode-accent)_35%,var(--border-default))] hover:bg-[color:color-mix(in_srgb,var(--mode-accent)_6%,var(--bg-surface))] hover:shadow-[var(--shadow-sm)]',
        !available &&
          'cursor-not-allowed opacity-[0.48] grayscale-[0.25] hover:translate-y-0 hover:border-[var(--border-subtle)] hover:shadow-none'
      )}
    >
      <span
        className={cn(
          'relative flex shrink-0 items-center justify-center border border-[color:color-mix(in_srgb,var(--mode-accent)_30%,var(--border-default))] bg-[color:color-mix(in_srgb,var(--mode-accent)_12%,var(--bg-overlay))] text-[var(--mode-accent)]',
          featured ? 'h-14 w-14 rounded-2xl' : 'h-11 w-11 rounded-xl'
        )}
      >
        <Icon size={featured ? 25 : 20} strokeWidth={1.8} />
      </span>

      <span className="relative min-w-0 flex-1 pr-7">
        <span
          className={cn(
            'block font-black tracking-[-0.02em] text-[var(--text-primary)]',
            featured ? 'text-2xl' : 'text-lg'
          )}
        >
          {title}
        </span>
        <span className="mt-1 block text-[13px] leading-relaxed text-[var(--text-secondary)]">
          {description}
        </span>
      </span>

      {selected && (
        <span
          className="absolute right-4 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full bg-[var(--mode-accent)] text-white"
          aria-hidden="true"
        >
          <Check size={15} />
        </span>
      )}
      {!available && (
        <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[11px] font-semibold text-[var(--text-muted)]">
          暂不可用
        </span>
      )}
    </button>
  );
}

export function GameSetupPage({
  onBack,
  onGameStart,
  onNavigateToOnlineRoom,
  onNavigateToPublicTable,
}: GameSetupPageProps) {
  const [currentStep, setCurrentStep] = useState<SetupStep>(0);
  const [setupMode, setSetupMode] = useState<SetupMode>(GameMode.SOLITAIRE);
  const [selectedP1DeckState, setSelectedP1Deck] = useState<DeckDisplayItem | null>(null);
  const [selectedP2DeckState, setSelectedP2Deck] = useState<DeckDisplayItem | null>(null);
  const [hasManualSelectedP1Deck, setHasManualSelectedP1Deck] = useState(false);
  const [hasManualSelectedP2Deck, setHasManualSelectedP2Deck] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isPublicTableMode = setupMode === 'PUBLIC_TABLE';
  const isOnlineMode = setupMode === 'ONLINE';
  const isRemoteEntryMode = isPublicTableMode || isOnlineMode;
  const gameMode = setupMode === GameMode.DEBUG ? GameMode.DEBUG : GameMode.SOLITAIRE;
  const isDebugMode = gameMode === GameMode.DEBUG;
  const maxStep: SetupStep = isRemoteEntryMode ? 1 : isDebugMode ? 3 : 2;
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
  const resolveDeckRecordCardType = useMemo(
    () => createDeckRecordCardTypeResolver(cardDataRegistry),
    [cardDataRegistry]
  );
  const deckDisplayItems = useMemo(
    () =>
      buildDeckDisplayItems({
        cloudDecks: validDecks,
        resolveDeckRecordCardType,
      }),
    [resolveDeckRecordCardType, validDecks]
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
    return !isRemoteEntryMode && !hasManualSelectedP1Deck ? p1PreferredDeck.deck : null;
  }, [
    deckDisplayItems,
    hasManualSelectedP1Deck,
    isRemoteEntryMode,
    p1PreferredDeck.deck,
    selectedP1DeckState,
  ]);
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

  // 选择模式
  const handleSelectMode = (mode: SetupMode) => {
    setSetupMode(mode);
    // 切换模式时重置卡组选择
    setSelectedP1Deck(null);
    setSelectedP2Deck(null);
    setHasManualSelectedP1Deck(false);
    setHasManualSelectedP2Deck(false);
    setError(null);
  };

  // 下一步
  const handleNext = () => {
    if (currentStep === 0) {
      if (isPublicTableMode) {
        if (canUseOnlineRoom) {
          onNavigateToPublicTable();
        }
        return;
      }
      if (isOnlineMode) {
        if (canUseOnlineRoom) {
          onNavigateToOnlineRoom();
        }
        return;
      }
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
    if (currentStep === 0) return isRemoteEntryMode ? canUseOnlineRoom : gameMode !== undefined;
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

      // 加载玩家 1 卡组
      const p1CloudDeck = selectedP1Deck.cloudDeck;
      if (!p1CloudDeck) {
        throw new Error('卡组数据无效');
      }

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
    if (!selectedP1Deck?.cloudDeck) {
      return;
    }

    if (gameMode === GameMode.SOLITAIRE) {
      writeLastUsedDeckId(DECK_SELECTION_PREFERENCE_KEYS.solitaire, selectedP1Deck.cloudDeck.id);
      return;
    }

    writeLastUsedDeckId(
      DECK_SELECTION_PREFERENCE_KEYS.localDebugPlayer1,
      selectedP1Deck.cloudDeck.id
    );
    if (selectedP2Deck?.cloudDeck) {
      writeLastUsedDeckId(
        DECK_SELECTION_PREFERENCE_KEYS.localDebugPlayer2,
        selectedP2Deck.cloudDeck.id
      );
    }
  }

  // 步骤指示器
  const renderStepIndicator = () => {
    const steps = isRemoteEntryMode
      ? [0, 1]
      : gameMode === GameMode.SOLITAIRE
        ? [0, 1, 2]
        : [0, 1, 2, 3];
    const labels = isRemoteEntryMode
      ? ['模式', isPublicTableMode ? '匹配' : '房间']
      : gameMode === GameMode.SOLITAIRE
        ? ['模式', '卡组', '确认']
        : ['模式', 'P1', 'P2', '确认'];
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

  const getNextButtonLabel = () => {
    if (currentStep === 0) {
      if (isPublicTableMode) {
        return canUseOnlineRoom ? '进入公共牌桌' : '公共牌桌暂不可用';
      }
      if (isOnlineMode) return canUseOnlineRoom ? '进入联机房间' : '联机暂不可用';
      if (gameMode === GameMode.SOLITAIRE) return '下一步：选择己方卡组';
      return '下一步：选择 P1 卡组';
    }
    if (currentStep === 1 && gameMode === GameMode.DEBUG) return '下一步：选择 P2 卡组';
    if (currentStep === 1 && gameMode === GameMode.SOLITAIRE) return '下一步：确认对局';
    if (currentStep === 2 && gameMode === GameMode.DEBUG) return '下一步：确认对局';
    return '下一步';
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
        {currentStep > 0 && renderStepIndicator()}

        {currentStep > 0 && (
          <motion.h2
            key={currentStep}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-5 text-center text-xl font-bold text-[var(--text-primary)] sm:mb-6 sm:text-2xl"
          >
            {getStepTitle()}
          </motion.h2>
        )}

        <div className="flex-1 min-h-0 relative">
          <AnimatePresence mode="wait">
            {currentStep === 0 && (
              <motion.div
                key="step0"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                className="absolute inset-0 overflow-y-auto overscroll-contain"
              >
                <div className="mx-auto w-full max-w-5xl pb-4">
                  <header className="mx-auto mb-5 text-center sm:mb-6">
                    <h1 className="text-3xl font-black tracking-[-0.035em] text-[var(--text-primary)] sm:text-4xl">
                      选择游戏模式
                    </h1>
                  </header>

                  <div className="rounded-[30px] border border-[var(--border-default)] bg-[color:color-mix(in_srgb,var(--bg-overlay)_44%,transparent)] p-2 shadow-[var(--shadow-sm)] backdrop-blur-md sm:p-3">
                    <ModeChoice
                      mode="PUBLIC_TABLE"
                      title="公共牌桌"
                      description="自动匹配真人对手"
                      icon={Swords}
                      toneClass="[--mode-accent:var(--accent-primary)]"
                      selected={setupMode === 'PUBLIC_TABLE'}
                      available={canUseOnlineRoom}
                      featured
                      onSelect={handleSelectMode}
                    />

                    <div className="mt-2 grid gap-2 md:grid-cols-3">
                      <ModeChoice
                        mode="ONLINE"
                        title="房间联机"
                        description="创建或加入房间"
                        icon={Globe2}
                        toneClass="[--mode-accent:var(--semantic-info)]"
                        selected={setupMode === 'ONLINE'}
                        available={canUseOnlineRoom}
                        onSelect={handleSelectMode}
                      />
                      <ModeChoice
                        mode={GameMode.SOLITAIRE}
                        title="对墙打"
                        description="单人测试完整流程"
                        icon={Target}
                        toneClass="[--mode-accent:var(--heart-green)]"
                        selected={setupMode === GameMode.SOLITAIRE}
                        available
                        onSelect={handleSelectMode}
                      />
                      <ModeChoice
                        mode={GameMode.DEBUG}
                        title="双人调试"
                        description="在同一桌面操作双方"
                        icon={Bug}
                        toneClass="[--mode-accent:var(--accent-secondary)]"
                        selected={setupMode === GameMode.DEBUG}
                        available
                        onSelect={handleSelectMode}
                      />
                    </div>
                  </div>
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
                className="absolute inset-0 flex items-start justify-center"
              >
                <div
                  className={`w-full max-w-3xl ${
                    validDecks.length > 6 || isLoadingCloud ? 'h-full' : ''
                  }`}
                >
                  <DeckSelector
                    cloudDecks={cloudDecks}
                    selectedId={selectedP1Deck?.id}
                    onSelect={handleSelectP1}
                    isLoading={isLoadingCloud}
                    error={cloudError}
                    onRefresh={fetchCloudDecks}
                    title="可用卡组"
                    emptyText="还没有可用卡组。"
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
                    validDecks.length > 6 || isLoadingCloud ? 'h-full' : ''
                  }`}
                >
                  <DeckSelector
                    cloudDecks={cloudDecks}
                    selectedId={selectedP2Deck?.id}
                    onSelect={handleSelectP2}
                    isLoading={isLoadingCloud}
                    error={cloudError}
                    onRefresh={fetchCloudDecks}
                    title="可用卡组"
                    emptyText="还没有可用卡组。"
                    density="compact"
                    lastUsedDeckId={p2LastUsedDeckId}
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
                          <div>默认对手卡组已准备完成，进入桌面后会显示对墙打模拟提示。</div>
                          <div
                            className={`mt-1 text-xs ${
                              canUseRecordedSolitaire
                                ? 'text-[var(--semantic-success)]'
                                : 'text-[var(--text-muted)]'
                            }`}
                          >
                            {canUseRecordedSolitaire
                              ? '在线记录：本局会保存到历史并可复盘'
                              : '本地模拟：本局不会保存历史'}
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

        <div
          className={cn(
            'sticky bottom-0 mt-5 w-full self-center rounded-[20px] border border-[var(--border-default)] bg-[color:color-mix(in_srgb,var(--bg-frosted)_94%,transparent)] p-3 shadow-[var(--shadow-md)] backdrop-blur-xl sm:static sm:mt-6 sm:rounded-none sm:border-0 sm:bg-transparent sm:p-0 sm:shadow-none',
            currentStep === 0 ? 'max-w-5xl' : 'max-w-2xl'
          )}
        >
          <div
            className={cn(
              'flex gap-2',
              currentStep === 0
                ? 'justify-stretch sm:justify-end'
                : 'flex-col-reverse sm:flex-row sm:justify-between'
            )}
          >
            {currentStep > 0 && (
              <button
                onClick={handlePrev}
                className="button-ghost inline-flex min-h-11 items-center justify-center gap-2 border border-[var(--border-default)] px-6 py-2 font-medium"
              >
                <ChevronLeft size={16} />
                上一步
              </button>
            )}

            {currentStep < maxStep && (
              <button
                onClick={handleNext}
                disabled={!canProceed()}
                className={cn(
                  'button-primary inline-flex min-h-11 items-center justify-center gap-2 px-6 py-2 font-medium',
                  currentStep === 0 && 'w-full sm:w-auto sm:min-w-56',
                  !canProceed() && 'cursor-not-allowed opacity-50'
                )}
              >
                {getNextButtonLabel()}
                <ChevronRight size={16} />
              </button>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

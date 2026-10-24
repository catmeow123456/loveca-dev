import { useTextPresentation } from '@/lib/appPresentation';
/**
 * GameSetupPage - 对墙打与双人调试的卡组准备
 * 在同一页选择卡组并开始（双人调试同时准备双方卡组）
 */

import { useEffect, useMemo, useState, useId, type ReactNode } from 'react';
import { Bug, ChevronLeft, Play, Target, Loader2 } from 'lucide-react';
import { useDeckStore } from '@/store/deckStore';
import { useGameStore } from '@/store/gameStore';
import {
  ActionButton,
  DeckSelector,
  ErrorNotice,
  Disclosure,
  SelectMenu,
  Tabs,
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
import { useMediaQuery } from '@/hooks/useMediaQuery';
import './game-setup.css';

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
  const [selectedSeat, setSelectedSeat] = useState<'P1' | 'P2'>('P1');
  const tabsId = useId();
  const compact = useMediaQuery('(max-width: 767px)');
  const [selectedP1DeckState, setSelectedP1Deck] = useState<DeckDisplayItem | null>(null);
  const [selectedP2DeckState, setSelectedP2Deck] = useState<DeckDisplayItem | null>(null);
  const [hasManualSelectedP1Deck, setHasManualSelectedP1Deck] = useState(false);
  const [hasManualSelectedP2Deck, setHasManualSelectedP2Deck] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isDebugMode = gameMode === GameMode.DEBUG;
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

  // 开始对局
  const handleStartGame = async () => {
    if (isStarting || !selectedP1Deck || (isDebugMode && !selectedP2Deck)) return;

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
        gameMode === GameMode.SOLITAIRE ? '对手（模拟）' : (selectedP2Deck?.name ?? 'Player 2');
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

  const modeControl = textOnly ? (
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
  ) : (
    <SelectMenu
      label="切换模式"
      triggerLabel="切换模式"
      value={gameMode}
      disabled={isStarting}
      onChange={onModeChange}
      options={[
        { value: GameMode.SOLITAIRE, label: '对墙打', leading: <Target size={16} /> },
        { value: GameMode.DEBUG, label: '双人调试', leading: <Bug size={16} /> },
      ]}
    />
  );
  const seats: Array<'P1' | 'P2'> = isDebugMode ? ['P1', 'P2'] : ['P1'];
  const activeSeats = isDebugMode && compact ? [selectedSeat] : seats;
  const canStart = Boolean(selectedP1Deck && (!isDebugMode || selectedP2Deck));

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
      <main
        className={cn(
          'game-setup',
          !isDebugMode && 'game-setup--single',
          textOnly && 'excel-setup'
        )}
      >
        <div className="game-setup-tools">
          <Disclosure summary="对局说明" variant="popover">
            <p>记录：{canUseRecordedSolitaire && !isDebugMode ? '保存至历史' : '不保存'}</p>
            <p>{isDebugMode ? '本机操作双方。' : '对手自动处理无需输入的流程。'}</p>
          </Disclosure>
          {modeControl}
        </div>
        {isDebugMode && compact && (
          <Tabs
            id={tabsId}
            panelId={`${tabsId}-panel`}
            label="选择玩家卡组"
            value={selectedSeat}
            onChange={setSelectedSeat}
            className="game-setup-seats"
            options={seats.map((seat) => ({
              value: seat,
              label: (
                <span className="min-w-0">
                  <span className="block">{seat === 'P1' ? 'Player 1' : 'Player 2'}</span>
                  <span className="block truncate text-xs font-normal">
                    {(seat === 'P1' ? selectedP1Deck : selectedP2Deck)?.name ?? '未选择'}
                  </span>
                </span>
              ),
            }))}
          />
        )}
        <div
          id={isDebugMode && compact ? `${tabsId}-panel` : undefined}
          role={isDebugMode && compact ? 'tabpanel' : undefined}
          aria-labelledby={isDebugMode && compact ? `${tabsId}-${selectedSeat}` : undefined}
          className={cn('game-setup-decks', isDebugMode && !compact && 'game-setup-decks--two')}
        >
          {activeSeats.map((seat) => (
            <div key={seat} className="game-setup-deck">
              <DeckSelector
                cloudDecks={cloudDecks}
                localDecks={offlineMode ? localDecks : []}
                selectedId={seat === 'P1' ? selectedP1Deck?.id : selectedP2Deck?.id}
                onSelect={seat === 'P1' ? handleSelectP1 : handleSelectP2}
                isLoading={!offlineMode && isLoadingCloud}
                isRefreshing={!offlineMode && isRefreshingCloud}
                error={offlineMode ? null : cloudError}
                onRefresh={offlineMode ? undefined : refreshCloudDecks}
                title={
                  isDebugMode ? `选择 Player ${seat === 'P1' ? '1' : '2'} 的卡组` : '选择己方卡组'
                }
                emptyText={
                  offlineMode ? '还没有可用的本地卡组。先从示例卡组创建一副。' : '还没有可用卡组。'
                }
                emptyActionLabel={offlineMode ? '创建本地卡组' : '管理卡组'}
                onEmptyAction={onManageDecks}
                density="compact"
                lastUsedDeckId={seat === 'P1' ? p1LastUsedDeckId : p2LastUsedDeckId}
              />
            </div>
          ))}
        </div>
        {error && <ErrorNotice message={error} className="game-setup-error" />}
        <footer className="game-setup-footer">
          <ActionButton variant="ghost" disabled={isStarting} onClick={onBack}>
            <ChevronLeft size={16} aria-hidden="true" />
            取消准备
          </ActionButton>
          <div className="game-setup-selection" aria-label="已选卡组">
            {seats.map((seat) => (
              <span key={seat} title={(seat === 'P1' ? selectedP1Deck : selectedP2Deck)?.name}>
                {isDebugMode && <span className="game-setup-seat-label">{seat}</span>}
                {(seat === 'P1' ? selectedP1Deck : selectedP2Deck)?.name ?? '未选择卡组'}
              </span>
            ))}
          </div>
          <ActionButton
            disabled={isStarting || !canStart}
            onClick={() => void handleStartGame()}
            className="game-setup-start"
          >
            {isStarting ? (
              <Loader2 size={16} className="animate-spin" aria-hidden="true" />
            ) : (
              <Play size={16} aria-hidden="true" />
            )}
            {isStarting ? '准备中…' : '开始对局'}
          </ActionButton>
        </footer>
      </main>
    </ProductFrame>
  );
}

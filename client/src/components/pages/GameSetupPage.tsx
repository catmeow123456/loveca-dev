/**
 * GameSetupPage - 游戏准备页面
 * Step 0: 选择游戏模式（调试模式 / 对墙打模式）
 * Step 1: 选择卡组（调试模式选 2 副，对墙打模式选 1 副）
 * Step 2: 确认并开始游戏
 */

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useDeckStore } from '@/store/deckStore';
import { useGameStore } from '@/store/gameStore';
import { DeckSelector, type DeckDisplayItem } from '@/components/common';
import { DeckLoader } from '@game/domain/card-data/deck-loader';
import { CardDataRegistry } from '@game/domain/card-data/loader';
import { loadSolitaireOpponentDeck } from '@game/application/solitaire-deck';
import type { DeckConfig } from '@game/application/game-service';
import { GameMode } from '@game/shared/types/enums';
import defaultOpponentDeckYaml from '../../../../assets/decks/缪预组.yaml?raw';

type SetupStep = 0 | 1 | 2 | 3;

interface GameSetupPageProps {
  onBack: () => void;
  onGameStart: () => void;
}

export function GameSetupPage({ onBack, onGameStart }: GameSetupPageProps) {
  const [currentStep, setCurrentStep] = useState<SetupStep>(0);
  const [gameMode, setLocalGameMode] = useState<GameMode>(GameMode.DEBUG);
  const [selectedP1Deck, setSelectedP1Deck] = useState<DeckDisplayItem | null>(null);
  const [selectedP2Deck, setSelectedP2Deck] = useState<DeckDisplayItem | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isDebugMode = gameMode === GameMode.DEBUG;
  const maxStep: SetupStep = isDebugMode ? 3 : 2;

  // Deck store
  const cloudDecks = useDeckStore((s) => s.cloudDecks);
  const isLoadingCloud = useDeckStore((s) => s.isLoadingCloud);
  const cloudError = useDeckStore((s) => s.cloudError);
  const fetchCloudDecks = useDeckStore((s) => s.fetchCloudDecks);

  // Game store
  const initializeGame = useGameStore((s) => s.initializeGame);
  const createGame = useGameStore((s) => s.createGame);
  const cardDataRegistry = useGameStore((s) => s.cardDataRegistry);
  const setGameMode = useGameStore((s) => s.setGameMode);

  // 加载云端卡组
  useEffect(() => {
    fetchCloudDecks();
  }, [fetchCloudDecks]);

  // 只显示有效的卡组
  const validDecks = cloudDecks.filter((d) => d.is_valid);

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
      // 创建 CardDataRegistry 和 DeckLoader
      const registry = new CardDataRegistry();
      registry.load(Array.from(cardDataRegistry.values()));
      const loader = new DeckLoader(registry);

      // 加载玩家 1 卡组
      const p1CloudDeck = selectedP1Deck.cloudDeck;
      if (!p1CloudDeck) {
        throw new Error('卡组数据无效');
      }

      const p1Config = convertCloudDeckToConfig(p1CloudDeck);
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
        const p2Config = convertCloudDeckToConfig(selectedP2Deck.cloudDeck);
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
      const p2Name = gameMode === GameMode.SOLITAIRE ? '对手 (AI)' : (selectedP2Deck?.cloudDeck?.name ?? 'Player 2');
      createGame(
        `game-${Date.now()}`,
        'player-1',
        p1Config.player_name,
        'player-2',
        p2Name
      );

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

  // 转换云端数据格式为本地 DeckConfig 格式
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const convertCloudDeckToConfig = (cloudDeck: any) => {
    const mainDeck = cloudDeck.main_deck || [];
    const members: { card_code: string; count: number }[] = [];
    const lives: { card_code: string; count: number }[] = [];

    for (const entry of mainDeck) {
      if (entry.card_type === 'LIVE') {
        lives.push({ card_code: entry.card_code, count: entry.count });
      } else if (entry.card_type === 'MEMBER') {
        members.push({ card_code: entry.card_code, count: entry.count });
      } else {
        throw new Error(`未知的卡牌类型: ${entry.card_type}`);
      }
    }

    return {
      player_name: cloudDeck.name,
      description: cloudDeck.description || '',
      main_deck: { members, lives },
      energy_deck: cloudDeck.energy_deck || [],
    };
  };

  // 步骤指示器
  const renderStepIndicator = () => {
    const steps = gameMode === GameMode.SOLITAIRE ? [0, 1, 2] : [0, 1, 2, 3];
    const labels =
      gameMode === GameMode.SOLITAIRE
        ? ['模式', '卡组', '确认']
        : ['模式', 'P1', 'P2', '确认'];

    return (
      <div className="flex items-center justify-center gap-4 mb-8">
        {steps.map((step, idx) => (
          <div key={step} className="flex items-center gap-2">
            <div
              className={`w-10 h-10 rounded-full flex items-center justify-center font-bold transition-all duration-300 ${
                currentStep === step
                  ? 'bg-gradient-to-r from-orange-400 to-amber-400 text-white shadow-lg shadow-orange-500/30'
                  : currentStep > step
                  ? 'bg-green-500/20 text-green-300 border border-green-400/30'
                  : 'bg-[#3d3020]/60 text-orange-300/50 border border-orange-300/20'
              }`}
            >
              {currentStep > step ? '✓' : idx + 1}
            </div>
            <span className="text-xs text-orange-300/60 min-w-[32px] text-center">{labels[idx]}</span>
            {idx < steps.length - 1 && (
              <div
                className={`w-12 h-0.5 transition-all duration-300 ${
                  currentStep > step ? 'bg-green-400' : 'bg-orange-300/20'
                }`}
              />
            )}
          </div>
        ))}
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
    <div className="min-h-screen bg-gradient-to-br from-[#2d2820] via-[#1f1a15] to-[#2d2820] flex flex-col">
      {/* Header */}
      <header className="h-16 bg-[#3d3020]/80 backdrop-blur-sm border-b border-orange-300/15 flex items-center justify-between px-6">
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-orange-300/70 hover:text-orange-300 transition-colors"
        >
          <span>←</span>
          <span>返回</span>
        </button>

        <div className="flex items-center gap-3">
          <span className="text-2xl">🎮</span>
          <h1 className="text-xl font-bold bg-gradient-to-r from-orange-300 to-amber-300 bg-clip-text text-transparent">
            游戏准备
          </h1>
        </div>

        <div className="w-20" /> {/* Spacer */}
      </header>

      {/* Main Content */}
      <main className="flex-1 flex flex-col p-6 overflow-hidden">
        {/* Step Indicator */}
        {renderStepIndicator()}

        {/* Step Title */}
        <motion.h2
          key={currentStep}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-2xl font-bold text-center text-orange-100 mb-6"
        >
          {getStepTitle()}
        </motion.h2>

        {/* Step Content */}
        <div className="flex-1 min-h-0 relative">
          <AnimatePresence mode="wait">
            {/* Step 0: Mode Selection */}
            {currentStep === 0 && (
              <motion.div
                key="step0"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                className="absolute inset-0 flex justify-center items-center"
              >
                <div className="w-full max-w-2xl grid md:grid-cols-2 gap-6">
                  {/* Debug Mode */}
                  <button
                    onClick={() => handleSelectMode(GameMode.DEBUG)}
                    className={`p-6 rounded-xl border-2 transition-all duration-300 text-left ${
                      gameMode === GameMode.DEBUG
                        ? 'bg-orange-500/10 border-orange-400/60 shadow-lg shadow-orange-500/10'
                        : 'bg-[#3d3020]/60 border-orange-300/20 hover:border-orange-300/40'
                    }`}
                  >
                    <div className="text-4xl mb-4">🔧</div>
                    <h3 className="text-xl font-bold text-orange-100 mb-2">调试模式</h3>
                    <p className="text-sm text-orange-300/60 leading-relaxed">
                      双人本地对战，手动切换双方视角操作。适用于规则验证和对局复现。
                    </p>
                    <div className="mt-4 flex items-center gap-2 text-xs text-orange-300/40">
                      <span>👥 2 人</span>
                      <span>·</span>
                      <span>📦 选 2 副卡组</span>
                    </div>
                  </button>

                  {/* Solitaire Mode */}
                  <button
                    onClick={() => handleSelectMode(GameMode.SOLITAIRE)}
                    className={`p-6 rounded-xl border-2 transition-all duration-300 text-left ${
                      gameMode === GameMode.SOLITAIRE
                        ? 'bg-purple-500/10 border-purple-400/60 shadow-lg shadow-purple-500/10'
                        : 'bg-[#3d3020]/60 border-orange-300/20 hover:border-purple-300/40'
                    }`}
                  >
                    <div className="text-4xl mb-4">🎯</div>
                    <h3 className="text-xl font-bold text-orange-100 mb-2">对墙打模式</h3>
                    <p className="text-sm text-orange-300/60 leading-relaxed">
                      单人测试卡组，系统自动跳过对手所有阶段。专注于测试己方卡组在各回合的表现。
                    </p>
                    <div className="mt-4 flex items-center gap-2 text-xs text-orange-300/40">
                      <span>👤 1 人</span>
                      <span>·</span>
                      <span>📦 选 1 副卡组</span>
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
            {((currentStep === 2 && gameMode === GameMode.SOLITAIRE) || (currentStep === 3 && gameMode === GameMode.DEBUG)) && (
              <motion.div
                key="step-confirm"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                className="absolute inset-0 flex justify-center items-center"
              >
                <div className="w-full max-w-2xl flex flex-col items-center">
                  {/* Mode Badge */}
                  <div className="mb-6 px-4 py-2 rounded-full text-sm font-medium bg-gradient-to-r from-orange-400/20 to-amber-400/20 border border-orange-300/30 text-orange-200">
                    {gameMode === GameMode.SOLITAIRE ? '🎯 对墙打模式' : '🔧 调试模式'}
                  </div>

                  {/* Summary Cards */}
                  <div className={`w-full grid gap-6 mb-8 ${gameMode === GameMode.SOLITAIRE ? 'grid-cols-1 max-w-md mx-auto' : 'md:grid-cols-2'}`}>
                    {/* P1 Summary */}
                    <div className="p-6 bg-[#3d3020]/60 rounded-xl border border-orange-300/20">
                      <div className="flex items-center gap-3 mb-4">
                        <span className="text-3xl">👤</span>
                        <div>
                          <div className="text-xs text-orange-300/50 uppercase tracking-wider">
                            {gameMode === GameMode.SOLITAIRE ? '己方' : 'Player 1'}
                          </div>
                          <div className="text-lg font-bold text-orange-100">
                            {selectedP1Deck?.name || '未选择'}
                          </div>
                        </div>
                      </div>
                      {selectedP1Deck && (
                        <div className="flex items-center gap-4 text-sm text-orange-300/60">
                          <span>👤 {selectedP1Deck.memberCount}/48</span>
                          <span>🎵 {selectedP1Deck.liveCount}/12</span>
                          <span>⚡ {selectedP1Deck.energyCount}/12</span>
                        </div>
                      )}
                    </div>

                    {/* P2 Summary (only in debug mode) */}
                    {gameMode === GameMode.DEBUG && (
                      <div className="p-6 bg-[#3d3020]/60 rounded-xl border border-orange-300/20">
                        <div className="flex items-center gap-3 mb-4">
                          <span className="text-3xl">👤</span>
                          <div>
                            <div className="text-xs text-orange-300/50 uppercase tracking-wider">Player 2</div>
                            <div className="text-lg font-bold text-orange-100">
                              {selectedP2Deck?.name || '未选择'}
                            </div>
                          </div>
                        </div>
                        {selectedP2Deck && (
                          <div className="flex items-center gap-4 text-sm text-orange-300/60">
                            <span>👤 {selectedP2Deck.memberCount}/48</span>
                            <span>🎵 {selectedP2Deck.liveCount}/12</span>
                            <span>⚡ {selectedP2Deck.energyCount}/12</span>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Solitaire opponent info */}
                    {gameMode === GameMode.SOLITAIRE && (
                      <div className="p-4 bg-[#3d3020]/40 rounded-xl border border-orange-300/10 flex items-center gap-3">
                        <span className="text-2xl opacity-30">🤖</span>
                        <div className="text-sm text-orange-300/40">
                          对手卡组由系统自动提供，无需选择
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Error Message */}
                  {error && (
                    <div className="w-full mb-6 p-4 bg-red-500/10 border border-red-400/30 rounded-xl">
                      <div className="flex items-center gap-2 text-red-300 text-sm">
                        <span>⚠️</span>
                        <span>{error}</span>
                      </div>
                    </div>
                  )}

                  {/* Start Button */}
                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={handleStartGame}
                    disabled={isStarting}
                    className={`px-12 py-4 rounded-2xl font-bold text-lg transition-all duration-300 ${
                      isStarting
                        ? 'bg-gray-600/50 text-gray-400 cursor-not-allowed'
                        : 'bg-gradient-to-r from-green-400 to-emerald-400 text-white shadow-lg shadow-green-500/30 hover:shadow-green-500/50'
                    }`}
                  >
                    {isStarting ? (
                      <span className="flex items-center gap-2">
                        <span className="animate-spin">⏳</span>
                        <span>准备中...</span>
                      </span>
                    ) : (
                      <span className="flex items-center gap-2">
                        <span>🎮</span>
                        <span>开始游戏！</span>
                      </span>
                    )}
                  </motion.button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Navigation Buttons */}
        <div className="flex justify-between mt-6 max-w-2xl mx-auto w-full">
          <button
            onClick={handlePrev}
            disabled={currentStep === 0}
            className={`px-6 py-2 rounded-full font-medium transition-all duration-300 ${
              currentStep === 0
                ? 'text-orange-300/30 cursor-not-allowed'
                : 'text-orange-300 hover:bg-orange-500/10 border border-orange-300/30 hover:border-orange-300/50'
            }`}
          >
            ← 上一步
          </button>

          {currentStep < maxStep && (
            <button
              onClick={handleNext}
              disabled={!canProceed()}
              className={`px-6 py-2 rounded-full font-medium transition-all duration-300 ${
                !canProceed()
                  ? 'bg-gray-600/50 text-gray-400 cursor-not-allowed'
                  : 'bg-gradient-to-r from-orange-400 to-amber-400 text-white shadow-lg shadow-orange-500/20 hover:shadow-orange-500/40'
              }`}
            >
              下一步 →
            </button>
          )}
        </div>
      </main>
    </div>
  );
}

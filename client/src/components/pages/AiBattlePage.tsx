import { useEffect, useMemo, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import {
  ArrowLeft,
  Bot,
  BrainCircuit,
  Check,
  ChevronRight,
  LoaderCircle,
  ShieldCheck,
  Sparkles,
  UserRound,
} from 'lucide-react';
import {
  createAiBattle,
  fetchCurrentAiBattle,
  fetchAiBattlePublicConfig,
  type AiBattleDeckKey,
  type AiBattlePublicConfig,
  type AiBattleView,
} from '@/lib/aiBattleClient';
import { ApiClientError } from '@/lib/apiClient';
import { useGameStore } from '@/store/gameStore';
import type { Seat } from '@game/online';

interface AiBattlePageProps {
  readonly onBack: () => void;
  readonly onGameStart: () => void;
}

const FALLBACK_DECKS: AiBattlePublicConfig['decks'] = [
  {
    deckKey: 'MUSE_STARTER',
    displayName: 'μ’s 预组',
    description: '节奏直接、适合熟悉完整对局流程。',
  },
  {
    deckKey: 'GREEN_HASUNOSORA_B6',
    displayName: '绿莲 6 弹',
    description: '资源与效果选择更丰富，适合测试复杂窗口。',
  },
];

export function AiBattlePage({ onBack, onGameStart }: AiBattlePageProps) {
  const connectRemoteSession = useGameStore((state) => state.connectRemoteSession);
  const applyRemoteSnapshot = useGameStore((state) => state.applyRemoteSnapshot);
  const reduceMotion = useReducedMotion();
  const [config, setConfig] = useState<AiBattlePublicConfig | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [humanDeckKey, setHumanDeckKey] = useState<AiBattleDeckKey>('MUSE_STARTER');
  const [aiDeckKey, setAiDeckKey] = useState<AiBattleDeckKey>('GREEN_HASUNOSORA_B6');
  const [aiSeat, setAiSeat] = useState<Seat>('SECOND');
  const [activeBattle, setActiveBattle] = useState<AiBattleView | null>(null);
  const [isCheckingActiveBattle, setIsCheckingActiveBattle] = useState(true);
  const [isStarting, setIsStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchAiBattlePublicConfig()
      .then((nextConfig) => {
        if (!cancelled) setConfig(nextConfig);
      })
      .catch((error) => {
        if (!cancelled) {
          setConfigError(error instanceof Error ? error.message : '读取 AI 对战配置失败');
        }
      });
    void fetchCurrentAiBattle()
      .then((battle) => {
        if (cancelled) return;
        setActiveBattle(battle);
        if (battle) {
          setHumanDeckKey(battle.humanDeckKey);
          setAiDeckKey(battle.aiDeckKey);
          setAiSeat(battle.systemSeat);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setStartError(error instanceof Error ? error.message : '检查当前 AI 对局失败');
        }
      })
      .finally(() => {
        if (!cancelled) setIsCheckingActiveBattle(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const decks = config?.decks ?? FALLBACK_DECKS;
  const humanDeck = useMemo(
    () => decks.find((deck) => deck.deckKey === humanDeckKey) ?? decks[0],
    [decks, humanDeckKey]
  );
  const aiDeck = useMemo(
    () => decks.find((deck) => deck.deckKey === aiDeckKey) ?? decks[0],
    [aiDeckKey, decks]
  );
  const unavailable = config !== null && !config.available;
  const visibleError =
    startError ??
    (activeBattle
      ? null
      : (configError ??
        (unavailable ? 'AI 对战暂未开放。服务端配置完成后可以从这里直接开局。' : null)));

  const enterBattle = async (battle: AiBattleView) => {
    connectRemoteSession({
      source: 'AI_BATTLE',
      matchId: battle.matchId,
      seat: battle.humanSeat,
      playerId: battle.snapshot.playerId,
    });
    await applyRemoteSnapshot(battle.snapshot);
    onGameStart();
  };

  const startBattle = async () => {
    if (isStarting || isCheckingActiveBattle || (!activeBattle && unavailable)) return;
    setIsStarting(true);
    setStartError(null);
    try {
      if (activeBattle) {
        await enterBattle(activeBattle);
        return;
      }
      const battle = await createAiBattle({ humanDeckKey, aiDeckKey, aiSeat });
      await enterBattle(battle);
    } catch (error) {
      if (error instanceof ApiClientError && error.code === 'AI_BATTLE_ALREADY_ACTIVE') {
        try {
          const battle = await fetchCurrentAiBattle();
          if (battle) {
            setActiveBattle(battle);
            await enterBattle(battle);
            return;
          }
        } catch (recoveryError) {
          setStartError(
            recoveryError instanceof Error ? recoveryError.message : '返回当前 AI 对局失败'
          );
          return;
        }
      }
      setStartError(error instanceof Error ? error.message : '创建 AI 对局失败');
    } finally {
      setIsStarting(false);
    }
  };

  return (
    <div className="app-shell min-h-screen overflow-x-hidden">
      <header className="border-b border-[var(--border-subtle)] bg-[color:color-mix(in_srgb,var(--bg-surface)_88%,transparent)] px-4 py-3 backdrop-blur sm:px-6">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
          <button
            type="button"
            onClick={onBack}
            className="button-ghost inline-flex min-h-10 items-center gap-2 px-3 text-sm font-semibold"
          >
            <ArrowLeft size={16} />
            返回大厅
          </button>
          <div className="flex items-center gap-2 text-xs font-semibold text-[var(--text-secondary)]">
            <ShieldCheck size={15} className="text-[var(--semantic-success)]" />
            规则自动检查 · 固定测试卡组
          </div>
        </div>
      </header>

      <main className="px-4 py-6 sm:px-6 sm:py-8">
        <div className="mx-auto max-w-6xl">
          <motion.section
            initial={reduceMotion ? false : { opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.32 }}
            className="mb-5 grid gap-4 border-b border-[var(--border-subtle)] pb-5 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-end"
          >
            <div>
              <div className="mb-2 flex items-center gap-2 text-xs font-bold tracking-[0.16em] text-[var(--accent-primary)]">
                <BrainCircuit size={15} />
                AI BATTLE
              </div>
              <h1 className="text-2xl font-black tracking-tight text-[var(--text-primary)] sm:text-3xl">
                挑好双方卡组，直接开局
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--text-secondary)]">
                对手是由系统操作的 Loveca AI。它只能选择当前允许的操作；AI
                这一步无法给出可用选择时会明确提示并稳妥处理，模型服务不可用时本局改用稳妥打法。
              </p>
            </div>
            <div className="rounded-lg border border-[color:color-mix(in_srgb,var(--accent-primary)_28%,var(--border-default))] bg-[color:color-mix(in_srgb,var(--accent-primary)_7%,var(--bg-surface))] px-4 py-3">
              <div className="flex items-start gap-3">
                <Bot size={20} className="mt-0.5 shrink-0 text-[var(--accent-primary)]" />
                <div>
                  <div className="text-sm font-bold text-[var(--text-primary)]">你正在挑战 AI</div>
                  <div className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">
                    聊天内容不会交给 AI；撤销与自由模式在此模式下关闭。
                  </div>
                </div>
              </div>
            </div>
          </motion.section>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
            <motion.section
              initial={reduceMotion ? false : { opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.32, delay: reduceMotion ? 0 : 0.05 }}
              className="surface-panel overflow-hidden"
            >
              <div className="grid md:grid-cols-[1fr_64px_1fr]">
                <DeckChooser
                  eyebrow="你的卡组"
                  icon={UserRound}
                  decks={decks}
                  selected={humanDeckKey}
                  onSelect={setHumanDeckKey}
                  disabled={activeBattle !== null}
                />

                <div className="relative flex min-h-16 items-center justify-center border-y border-[var(--border-subtle)] bg-[var(--bg-overlay)] md:min-h-full md:border-x md:border-y-0">
                  <div className="absolute inset-x-5 top-1/2 h-px bg-[var(--border-default)] md:inset-x-auto md:inset-y-8 md:left-1/2 md:h-auto md:w-px" />
                  <div className="relative flex h-10 w-10 items-center justify-center rounded-full border border-[var(--border-default)] bg-[var(--bg-surface)] font-black text-[var(--accent-primary)] shadow-[var(--shadow-sm)]">
                    VS
                  </div>
                </div>

                <DeckChooser
                  eyebrow="AI 的卡组"
                  icon={Bot}
                  decks={decks}
                  selected={aiDeckKey}
                  onSelect={setAiDeckKey}
                  disabled={activeBattle !== null}
                />
              </div>
            </motion.section>

            <motion.aside
              initial={reduceMotion ? false : { opacity: 0, x: 12 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.32, delay: reduceMotion ? 0 : 0.1 }}
              className="surface-panel flex flex-col p-4"
            >
              <div className="text-xs font-bold tracking-[0.12em] text-[var(--text-muted)]">
                出场顺序
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <SeatButton
                  selected={aiSeat === 'SECOND'}
                  label="我先手"
                  detail="AI 后手"
                  onClick={() => setAiSeat('SECOND')}
                  disabled={activeBattle !== null}
                />
                <SeatButton
                  selected={aiSeat === 'FIRST'}
                  label="AI 先手"
                  detail="我后手"
                  onClick={() => setAiSeat('FIRST')}
                  disabled={activeBattle !== null}
                />
              </div>

              {activeBattle ? (
                <div
                  role="status"
                  className="mt-4 rounded-lg border border-[color:color-mix(in_srgb,var(--semantic-success)_35%,var(--border-default))] bg-[color:color-mix(in_srgb,var(--semantic-success)_8%,var(--bg-surface))] px-3 py-2 text-xs leading-5 text-[var(--text-secondary)]"
                >
                  检测到当前账号有一局尚未离开的 AI 对局（{activeBattle.roomCode}
                  ）。卡组和先后手已锁定，可以直接返回继续。
                </div>
              ) : null}

              <div className="my-4 border-t border-[var(--border-subtle)]" />

              <div className="space-y-2 text-xs leading-5 text-[var(--text-secondary)]">
                <SummaryRow label="你" value={humanDeck?.displayName ?? humanDeckKey} />
                <SummaryRow label="AI" value={aiDeck?.displayName ?? aiDeckKey} />
                <SummaryRow label="AI 版本" value={config?.opponent.modelId ?? '读取中…'} mono />
              </div>

              {visibleError ? (
                <div
                  role="alert"
                  className="mt-4 rounded-lg border border-[color:color-mix(in_srgb,var(--semantic-error)_35%,var(--border-default))] bg-[color:color-mix(in_srgb,var(--semantic-error)_8%,var(--bg-surface))] px-3 py-2 text-xs leading-5 text-[var(--semantic-error)]"
                >
                  {visibleError}
                </div>
              ) : null}

              <button
                type="button"
                onClick={() => void startBattle()}
                disabled={
                  isStarting ||
                  isCheckingActiveBattle ||
                  (!activeBattle && (config === null || unavailable))
                }
                className="button-primary mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 px-4 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-55"
              >
                {isCheckingActiveBattle ? (
                  <>
                    <LoaderCircle size={17} className="animate-spin" />
                    正在检查已有对局
                  </>
                ) : isStarting ? (
                  <>
                    <LoaderCircle size={17} className="animate-spin" />
                    {activeBattle ? '正在返回对局' : '正在建立对局'}
                  </>
                ) : activeBattle ? (
                  <>
                    返回当前 AI 对局
                    <ChevronRight size={17} />
                  </>
                ) : (
                  <>
                    开始 AI 对战
                    <ChevronRight size={17} />
                  </>
                )}
              </button>
            </motion.aside>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <Assurance
              icon={ShieldCheck}
              title="每步都检查规则"
              detail="AI 只能选择当前允许的操作，不能直接移动或修改卡牌。"
            />
            <Assurance
              icon={Sparkles}
              title="AI 出错也能继续"
              detail="连续两次选错只稳妥处理当前步骤；模型服务不可用时本局改用稳妥打法。"
            />
            <Assurance
              icon={BrainCircuit}
              title="看不到你的隐藏牌"
              detail="AI 只能看到自己席位本来就能看到的牌面与选项。"
            />
          </div>
        </div>
      </main>
    </div>
  );
}

function DeckChooser({
  eyebrow,
  icon: Icon,
  decks,
  selected,
  onSelect,
  disabled,
}: {
  readonly eyebrow: string;
  readonly icon: typeof Bot;
  readonly decks: AiBattlePublicConfig['decks'];
  readonly selected: AiBattleDeckKey;
  readonly onSelect: (deckKey: AiBattleDeckKey) => void;
  readonly disabled: boolean;
}) {
  return (
    <div className="p-4 sm:p-5">
      <div className="mb-3 flex items-center gap-2 text-sm font-bold text-[var(--text-primary)]">
        <Icon size={17} className="text-[var(--accent-primary)]" />
        {eyebrow}
      </div>
      <div className="grid gap-2">
        {decks.map((deck) => {
          const active = deck.deckKey === selected;
          return (
            <button
              key={deck.deckKey}
              type="button"
              aria-pressed={active}
              onClick={() => onSelect(deck.deckKey)}
              disabled={disabled}
              className={`flex min-h-[84px] w-full items-start gap-3 rounded-lg border px-3 py-3 text-left transition disabled:cursor-not-allowed disabled:opacity-65 ${
                active
                  ? 'border-[color:color-mix(in_srgb,var(--accent-primary)_58%,var(--border-default))] bg-[color:color-mix(in_srgb,var(--accent-primary)_10%,var(--bg-surface))] shadow-[inset_3px_0_0_var(--accent-primary)]'
                  : 'border-[var(--border-subtle)] bg-[var(--bg-overlay)] hover:border-[var(--border-default)]'
              }`}
            >
              <span
                className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                  active
                    ? 'border-[var(--accent-primary)] bg-[var(--accent-primary)] text-white'
                    : 'border-[var(--border-default)] text-transparent'
                }`}
              >
                <Check size={12} strokeWidth={3} />
              </span>
              <span>
                <span className="block text-sm font-bold text-[var(--text-primary)]">
                  {deck.displayName}
                </span>
                <span className="mt-1 block text-xs leading-5 text-[var(--text-secondary)]">
                  {deck.description}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SeatButton({
  selected,
  label,
  detail,
  onClick,
  disabled,
}: {
  readonly selected: boolean;
  readonly label: string;
  readonly detail: string;
  readonly onClick: () => void;
  readonly disabled: boolean;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      disabled={disabled}
      className={`rounded-lg border px-3 py-2 text-left transition disabled:cursor-not-allowed disabled:opacity-65 ${
        selected
          ? 'border-[var(--accent-primary)] bg-[color:color-mix(in_srgb,var(--accent-primary)_10%,var(--bg-surface))]'
          : 'border-[var(--border-subtle)] bg-[var(--bg-overlay)]'
      }`}
    >
      <span className="block text-sm font-bold text-[var(--text-primary)]">{label}</span>
      <span className="mt-0.5 block text-[11px] text-[var(--text-muted)]">{detail}</span>
    </button>
  );
}

function SummaryRow({
  label,
  value,
  mono = false,
}: {
  readonly label: string;
  readonly value: string;
  readonly mono?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="shrink-0 text-[var(--text-muted)]">{label}</span>
      <span
        className={`min-w-0 break-all text-right font-semibold text-[var(--text-primary)] ${
          mono ? 'font-mono text-[11px]' : ''
        }`}
      >
        {value}
      </span>
    </div>
  );
}

function Assurance({
  icon: Icon,
  title,
  detail,
}: {
  readonly icon: typeof Bot;
  readonly title: string;
  readonly detail: string;
}) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-3">
      <Icon size={17} className="mt-0.5 shrink-0 text-[var(--accent-primary)]" />
      <div>
        <div className="text-xs font-bold text-[var(--text-primary)]">{title}</div>
        <div className="mt-0.5 text-xs leading-5 text-[var(--text-secondary)]">{detail}</div>
      </div>
    </div>
  );
}

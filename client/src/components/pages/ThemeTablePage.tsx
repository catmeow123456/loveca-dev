import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import {
  BookOpen,
  Clock3,
  ExternalLink,
  Loader2,
  Shuffle,
  Sparkles,
  TicketCheck,
} from 'lucide-react';
import type {
  ThemeMatchupStatisticsView,
  ThemePrebuiltDeckView,
} from '@game/online/theme-table-types';
import type { AnyCardData } from '@game/domain/entities/card';
import { ActionButton, PageHeader, Panel, StatusBadge } from '@/components/common';
import { CardDetailDrawer } from '@/components/deck-editor/CardDetailDrawer';
import { ThemeDeckGallery } from '@/components/theme-table/ThemeDeckGallery';
import { resolveCardImagePath, resolveRegistryCardImagePath } from '@/lib/imageService';
import { useThemeTableStore } from '@/store/themeTableStore';
import { useGameStore } from '@/store/gameStore';
import './theme-table.css';

export function ThemeTablePage({ onBack }: { onBack: () => void }) {
  const { overview, loading, error, refresh, join, cancel } = useThemeTableStore();
  const cardDataRegistry = useGameStore((state) => state.cardDataRegistry);
  const [selectedDeckId, setSelectedDeckId] = useState<string | null>(null);
  const [selectedCard, setSelectedCard] = useState<AnyCardData | null>(null);
  useEffect(() => {
    void refresh().catch(() => undefined);
  }, [refresh]);
  if (!overview && loading) {
    return <CenteredState icon={<Loader2 className="animate-spin" />} title="正在读取本期节目单" />;
  }
  if (!overview?.event) {
    return (
      <div className="app-shell min-h-screen">
        <PageHeader title="娱乐模式" onBack={onBack} backLabel="返回大厅" />
        <main className="mx-auto max-w-lg px-4 py-16">
          <Panel padding="spacious" className="text-center">
            <Sparkles className="mx-auto text-[var(--accent-primary)]" />
            <h1 className="mt-3 text-xl font-semibold">下一期娱乐模式正在编排</h1>
            <p className="mt-2 text-sm text-[var(--text-secondary)]">
              当前没有公开活动。你仍可前往公共牌桌使用自己的卡组对战。
            </p>
          </Panel>
        </main>
      </div>
    );
  }
  const { event, availability, player, queue } = overview;
  const activeQueue = queue.state !== 'IDLE';
  return (
    <div className="app-shell theme-table-page min-h-screen">
      <PageHeader title="娱乐模式" onBack={onBack} backLabel="返回大厅" />
      <main className="mx-auto w-full max-w-6xl px-4 py-5 sm:px-6 sm:py-8">
        <section className="theme-table-hero">
          <div className="theme-table-hero__copy">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge tone={availability.canJoin ? 'success' : 'neutral'}>
                {availability.canJoin ? '正在开放' : availability.message}
              </StatusBadge>
              <span className="text-xs font-semibold text-white/60">记录胜负 · 不计分</span>
            </div>
            <h1>{event.name}</h1>
            <p>{event.summary}</p>
            <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-sm text-white/70">
              <span className="inline-flex items-center gap-2">
                <Clock3 size={15} />
                {event.scheduleLabel}
              </span>
              <span className="inline-flex items-center gap-2">
                <Shuffle size={15} />
                确认后随机分配双方位置
              </span>
            </div>
          </div>
          <div className="theme-table-draw" aria-label="从已验证组合中抽取本局双方卡组">
            {event.prebuiltDecks.slice(0, 3).map((deck, index) => (
              <img
                key={deck.id}
                src={resolveRegistryCardImagePath(
                  deck.mainDeck[0]?.cardCode ?? 'back',
                  cardDataRegistry,
                  'medium'
                )}
                alt=""
                style={{ '--draw-index': index } as CSSProperties}
              />
            ))}
            <div>
              <TicketCheck size={18} />
              <span>随机分配</span>
            </div>
          </div>
        </section>

        <Panel padding="compact" className="theme-table-entry-panel mt-4">
          <div className="theme-table-entry-panel__main">
            <div>
              <div className="font-semibold text-[var(--text-primary)]">
                {activeQueue ? (queue.deckName ?? '卡组尚未揭晓') : availability.message}
              </div>
              <p className="mt-1 text-sm text-[var(--text-muted)]">
                不使用个人卡组；系统从本期卡组池为双方分配，可能出现同卡组对局。
              </p>
            </div>
            {activeQueue ? (
              <ActionButton
                variant="secondary"
                disabled={loading || queue.state === 'CREATING_ROOM'}
                onClick={() => void cancel()}
              >
                退出候场
              </ActionButton>
            ) : (
              <ActionButton disabled={!availability.canJoin || loading} onClick={() => void join()}>
                {loading ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
                加入娱乐模式
              </ActionButton>
            )}
          </div>
          <div
            className="theme-table-season-record"
            aria-label={`本期战绩 ${player?.wins ?? 0} 胜 ${player?.losses ?? 0} 负`}
          >
            <span className="theme-table-season-record__label">本期战绩</span>
            <strong>
              {player?.wins ?? 0} 胜 <i aria-hidden="true">·</i> {player?.losses ?? 0} 负
            </strong>
            <span>
              {player && player.completedMatches > 0
                ? `共 ${player.completedMatches} 局${player.draws > 0 ? ` · ${player.draws} 平` : ''} · 胜率 ${Math.round((player.winRate ?? 0) * 100)}%`
                : '完成首局后更新'}
            </span>
          </div>
        </Panel>
        {error ? <p className="mt-3 text-sm text-[var(--semantic-error)]">{error}</p> : null}

        <section className="mt-8">
          <div className="mb-3 flex items-end justify-between gap-4">
            <div>
              <p className="text-xs font-semibold text-[var(--accent-primary)]">本期预组池</p>
              <h2 className="mt-1 text-xl font-semibold text-[var(--text-primary)]">
                {event.prebuiltDecks.length} 副公开卡组
              </h2>
            </div>
            <span className="text-xs text-[var(--text-muted)]">选择卡组，点击卡图查看详情</span>
          </div>
          <ThemeDeckBrowser
            decks={event.prebuiltDecks}
            selectedDeckId={selectedDeckId}
            onSelectDeck={setSelectedDeckId}
            onViewCard={setSelectedCard}
          />
        </section>
        <section className="mt-8" aria-labelledby="theme-matchup-graph-title">
          <div className="mb-3">
            <p className="text-xs font-semibold text-[var(--accent-primary)]">本期对阵数据</p>
            <h2
              id="theme-matchup-graph-title"
              className="mt-1 text-xl font-semibold text-[var(--text-primary)]"
            >
              卡组对阵胜负
            </h2>
          </div>
          <ThemeMatchupGraph decks={event.prebuiltDecks} statistics={event.matchupStatistics} />
        </section>
      </main>
      <CardDetailDrawer card={selectedCard} onClose={() => setSelectedCard(null)} />
    </div>
  );
}

function ThemeMatchupGraph({
  decks,
  statistics,
}: {
  decks: readonly ThemePrebuiltDeckView[];
  statistics: readonly ThemeMatchupStatisticsView[];
}) {
  const graph = useMemo(() => buildMatchupGraph(decks, statistics), [decks, statistics]);
  const [hoveredEdgeKey, setHoveredEdgeKey] = useState<string | null>(null);
  const [selectedEdgeKey, setSelectedEdgeKey] = useState<string | null>(null);
  const visibleEdgeKey = selectedEdgeKey ?? hoveredEdgeKey;
  return (
    <div className="theme-matchup-graph" role="region" tabIndex={0} aria-label="卡组对阵关系图">
      <svg
        className="theme-matchup-graph__canvas"
        viewBox={`0 0 ${graph.width} ${graph.height}`}
        role="group"
        aria-label="卡组之间的对阵胜负关系图"
      >
        <title>卡组对阵胜负关系图</title>
        <desc>
          {graph.edges.length > 0
            ? graph.edges
                .map(
                  (edge) =>
                    `${edge.first.deck.displayName} 对 ${edge.second.deck.displayName}：${edge.firstWins} 比 ${edge.secondWins}`
                )
                .join('；')
            : '当前暂无不同卡组之间的已完成对局'}
        </desc>
        {graph.edges.map((edge) => (
          <MatchupGraphEdge
            key={edge.key}
            edge={edge}
            active={visibleEdgeKey === edge.key}
            onHoverChange={(isHovered) => setHoveredEdgeKey(isHovered ? edge.key : null)}
            onToggle={() =>
              setSelectedEdgeKey((current) => (current === edge.key ? null : edge.key))
            }
          />
        ))}
        {graph.nodes.map((node) => (
          <MatchupGraphNode key={node.deck.id} node={node} />
        ))}
      </svg>
    </div>
  );
}

interface MatchupGraphNodeData {
  readonly deck: ThemePrebuiltDeckView;
  readonly index: number;
  readonly x: number;
  readonly y: number;
  readonly color: string;
}

interface MatchupGraphEdgeData {
  readonly key: string;
  readonly first: MatchupGraphNodeData;
  readonly second: MatchupGraphNodeData;
  readonly completedMatches: number;
  readonly firstWins: number;
  readonly secondWins: number;
  readonly draws: number;
}

interface MatchupGraphData {
  readonly width: number;
  readonly height: number;
  readonly nodes: readonly MatchupGraphNodeData[];
  readonly edges: readonly MatchupGraphEdgeData[];
}

function MatchupGraphEdge({
  edge,
  active,
  onHoverChange,
  onToggle,
}: {
  edge: MatchupGraphEdgeData;
  active: boolean;
  onHoverChange: (isHovered: boolean) => void;
  onToggle: () => void;
}) {
  const totalMatches = Math.max(
    edge.completedMatches,
    edge.firstWins + edge.secondWins + edge.draws,
    1
  );
  const firstWinEnd = pointAlongEdge(edge, edge.firstWins / totalMatches);
  const drawEnd = pointAlongEdge(edge, (edge.firstWins + edge.draws) / totalMatches);
  const labelPoint = pointAlongEdge(edge, 0.5);
  const label = `${edge.firstWins} : ${edge.secondWins}`;
  const labelWidth = 58;
  return (
    <g
      className={`theme-matchup-graph__edge ${active ? 'is-active' : ''}`}
      data-edge-key={edge.key}
      role="button"
      tabIndex={0}
      aria-pressed={active}
      aria-label={`${edge.first.deck.displayName} 对 ${edge.second.deck.displayName}，第一套卡组 ${edge.firstWins} 胜，第二套卡组 ${edge.secondWins} 胜${edge.draws > 0 ? `，${edge.draws} 平` : ''}`}
      onMouseEnter={() => onHoverChange(true)}
      onMouseLeave={() => onHoverChange(false)}
      onFocus={() => onHoverChange(true)}
      onBlur={() => onHoverChange(false)}
      onClick={onToggle}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onToggle();
        }
      }}
    >
      <title>
        {edge.first.deck.displayName} 对 {edge.second.deck.displayName}：{label}
        {edge.draws > 0 ? `，${edge.draws} 平` : ''}
      </title>
      <line
        x1={edge.first.x}
        y1={edge.first.y}
        x2={edge.second.x}
        y2={edge.second.y}
        className="theme-matchup-graph__edge-hit-area"
        aria-hidden="true"
      />
      <line
        x1={edge.first.x}
        y1={edge.first.y}
        x2={firstWinEnd.x}
        y2={firstWinEnd.y}
        stroke={edge.first.color}
        strokeWidth="3"
        pointerEvents="none"
      />
      {edge.draws > 0 ? (
        <line
          x1={firstWinEnd.x}
          y1={firstWinEnd.y}
          x2={drawEnd.x}
          y2={drawEnd.y}
          stroke="var(--text-muted)"
          strokeWidth="3"
          pointerEvents="none"
        />
      ) : null}
      <line
        x1={drawEnd.x}
        y1={drawEnd.y}
        x2={edge.second.x}
        y2={edge.second.y}
        stroke={edge.second.color}
        strokeWidth="3"
        pointerEvents="none"
      />
      <rect
        x={labelPoint.x - labelWidth / 2}
        y={labelPoint.y - 15}
        width={labelWidth}
        height="30"
        rx="15"
        className="theme-matchup-graph__edge-label-bg"
      />
      <text
        x={labelPoint.x}
        y={labelPoint.y + 6}
        textAnchor="middle"
        className="theme-matchup-graph__edge-label"
      >
        <tspan className="theme-matchup-graph__edge-label-first" style={{ fill: edge.first.color }}>
          {edge.firstWins}
        </tspan>
        <tspan className="theme-matchup-graph__edge-label-separator"> : </tspan>
        <tspan
          className="theme-matchup-graph__edge-label-second"
          style={{ fill: edge.second.color }}
        >
          {edge.secondWins}
        </tspan>
      </text>
    </g>
  );
}

function pointAlongEdge(edge: Pick<MatchupGraphEdgeData, 'first' | 'second'>, ratio: number) {
  const clampedRatio = Math.max(0, Math.min(1, ratio));
  return {
    x: edge.first.x + (edge.second.x - edge.first.x) * clampedRatio,
    y: edge.first.y + (edge.second.y - edge.first.y) * clampedRatio,
  };
}

function MatchupGraphNode({ node }: { node: MatchupGraphNodeData }) {
  return (
    <g className="theme-matchup-graph__node" role="img" aria-label={node.deck.displayName}>
      <title>{node.deck.displayName}</title>
      <circle cx={node.x} cy={node.y} r="24" fill={node.color} />
      <circle cx={node.x} cy={node.y} r="20" className="theme-matchup-graph__node-inner" />
      <text
        x={node.x}
        y={node.y + 6}
        textAnchor="middle"
        className="theme-matchup-graph__node-index"
      >
        {String(node.index + 1).padStart(2, '0')}
      </text>
      <text
        x={node.x}
        y={node.y + 48}
        textAnchor="middle"
        className="theme-matchup-graph__node-name"
      >
        {node.deck.displayName}
      </text>
    </g>
  );
}

function buildMatchupGraph(
  decks: readonly ThemePrebuiltDeckView[],
  statistics: readonly ThemeMatchupStatisticsView[]
): MatchupGraphData {
  const width = 760;
  const height = Math.max(380, Math.min(560, 220 + decks.length * 34));
  const centerX = width / 2;
  const centerY = height / 2;
  const radius = Math.max(118, Math.min(width / 2 - 105, height / 2 - 78));
  const nodes = decks.map((deck, index) => {
    const angle = -Math.PI / 2 + (index * Math.PI * 2) / Math.max(decks.length, 1);
    return {
      deck,
      index,
      x: centerX + Math.cos(angle) * radius,
      y: centerY + Math.sin(angle) * radius,
      color: deckColor(index),
    };
  });
  const nodesById = new Map(nodes.map((node) => [node.deck.id, node]));
  const edges = statistics.flatMap((statistic) => {
    if (
      statistic.firstDeckVersionId === statistic.secondDeckVersionId ||
      statistic.completedMatches === 0
    ) {
      return [];
    }
    const first = nodesById.get(statistic.firstDeckVersionId);
    const second = nodesById.get(statistic.secondDeckVersionId);
    if (!first || !second) return [];
    return [
      {
        key: `${statistic.firstDeckVersionId}:${statistic.secondDeckVersionId}`,
        first,
        second,
        completedMatches: statistic.completedMatches,
        firstWins: statistic.firstDeckWins,
        secondWins: statistic.secondDeckWins,
        draws: statistic.draws,
      },
    ];
  });
  return { width, height, nodes, edges };
}

function deckColor(index: number) {
  const palette = [
    'var(--accent-primary)',
    'var(--accent-secondary)',
    'var(--semantic-info)',
    'var(--semantic-success)',
    'var(--semantic-warning)',
    'var(--semantic-error)',
  ];
  return palette[index % palette.length];
}

function ThemeDeckBrowser({
  decks,
  selectedDeckId,
  onSelectDeck,
  onViewCard,
}: {
  decks: readonly ThemePrebuiltDeckView[];
  selectedDeckId: string | null;
  onSelectDeck: (deckId: string) => void;
  onViewCard: (card: AnyCardData) => void;
}) {
  const cardDataRegistry = useGameStore((state) => state.cardDataRegistry);
  const selectedDeck = decks.find((deck) => deck.id === selectedDeckId) ?? decks[0];

  if (!selectedDeck) {
    return (
      <div className="theme-deck-browser theme-deck-browser--empty">本期尚未公开预组卡表。</div>
    );
  }

  return (
    <div className="theme-deck-browser">
      <nav className="theme-deck-browser__selector" aria-label="本期预组卡组">
        {decks.map((deck) => {
          const selected = deck.id === selectedDeck.id;
          const previewEntries = [...deck.mainDeck, ...deck.energyDeck].slice(0, 3);
          return (
            <button
              key={deck.id}
              type="button"
              className={`theme-deck-option ${selected ? 'is-selected' : ''}`}
              aria-pressed={selected}
              aria-controls="theme-deck-sheet"
              onClick={() => onSelectDeck(deck.id)}
            >
              <span className="theme-deck-option__preview" aria-hidden="true">
                {previewEntries.map((entry, index) => (
                  <img
                    key={`${entry.cardCode}-${index}`}
                    src={resolveCardImagePath(cardDataRegistry.get(entry.cardCode), 'thumb')}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    style={
                      {
                        '--preview-offset': `${index * 8}px`,
                        '--preview-rotation': `${(index - 1) * 5}deg`,
                      } as CSSProperties
                    }
                  />
                ))}
              </span>
              <span className="theme-deck-option__copy">
                <strong>{deck.displayName}</strong>
                {deck.playStyleTags.length > 0 ? (
                  <span>{deck.playStyleTags.join(' · ')}</span>
                ) : null}
              </span>
            </button>
          );
        })}
      </nav>

      <article
        id="theme-deck-sheet"
        className="theme-deck-sheet"
        aria-label={`${selectedDeck.displayName}完整卡表`}
      >
        <header className="theme-deck-sheet__header">
          <div>
            <div className="theme-deck-sheet__eyebrow">
              <BookOpen size={14} aria-hidden="true" /> 当前卡组卡册
            </div>
            <h3>{selectedDeck.displayName}</h3>
            <p>{selectedDeck.sourceLabel}</p>
          </div>
          {selectedDeck.playStyleTags.length > 0 ? (
            <div className="theme-deck-sheet__tags" aria-label="卡组标签">
              {selectedDeck.playStyleTags.map((tag) => (
                <span key={tag}>{tag}</span>
              ))}
            </div>
          ) : null}
        </header>

        <ThemeDeckGallery deck={selectedDeck} onViewCard={onViewCard} />

        <footer className="theme-deck-sheet__footer">
          {selectedDeck.sourceUrl ? (
            <a href={selectedDeck.sourceUrl} target="_blank" rel="noreferrer">
              <ExternalLink size={13} aria-hidden="true" />
              查看锁组 / DeckLog 来源
            </a>
          ) : null}
          <span>卡表版本 {selectedDeck.contentHash.slice(0, 12)}</span>
        </footer>
      </article>
    </div>
  );
}

function CenteredState({ icon, title }: { icon: ReactNode; title: string }) {
  return (
    <div className="app-shell flex min-h-screen items-center justify-center">
      <div className="text-center text-[var(--text-secondary)]">
        {icon}
        <p className="mt-3">{title}</p>
      </div>
    </div>
  );
}

import { useDialogAccessibility } from '@/hooks/useDialogAccessibility';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowDownUp,
  ChartColumn,
  Check,
  ChevronDown,
  Clock3,
  Heart,
  Info,
  RotateCcw,
  X,
  ZoomIn,
} from 'lucide-react';
import { ActionButton, ConfirmDialog, SelectMenu } from '@/components/common';
import { getPresentationPortalRoot } from '@/lib/appPresentation';
import { SEALED_DRAFT_LEAVE_EVENT } from '@/lib/sealedDraftNavigation';
import { getGroupDisplayName } from '@/components/deck-editor/filter-constants';
import type { CasualTableOwnView, SealedPoolView } from '@game/online/casual-table-types';
import { CardType } from '@game/shared/types/enums';
import { useCasualTableStore } from '@/store/casualTableStore';
import { resolveCardImagePath } from '@/lib/imageService';
import { PresentationImage } from '@/components/excel/PresentationRoot';
import './sealed-builder.css';

type PoolCard = SealedPoolView['cards'][number];
const MEMBER_SORT_OPTIONS = [
  { value: 'COST_ASC', label: '费用升序' },
  { value: 'COST_DESC', label: '费用降序' },
  { value: 'CARD_CODE', label: '卡号顺序' },
  { value: 'OPENING', label: '开盒顺序' },
] as const;
type MemberSort = (typeof MEMBER_SORT_OPTIONS)[number]['value'];
interface SealedBuilderProps {
  table: CasualTableOwnView;
  userId: string;
  now: number;
  roomCodeAction: ReactNode;
}

export function SealedBuilder({ table, userId, now, roomCodeAction }: SealedBuilderProps) {
  const pool = table.sealedPool;
  return pool ? (
    <Builder
      key={pool.poolId}
      table={table}
      pool={pool}
      userId={userId}
      now={now}
      roomCodeAction={roomCodeAction}
    />
  ) : null;
}

function Builder({
  table,
  pool,
  userId,
  now,
  roomCodeAction,
}: SealedBuilderProps & { pool: SealedPoolView }) {
  const mutate = useCasualTableStore((state) => state.mutate);
  const busy = useCasualTableStore((state) => state.busy);
  const error = useCasualTableStore((state) => state.error);
  const storageKey = `loveca.sealed.opened:${userId}:${pool.poolId}`;
  const [opened, setOpened] = useState(() =>
    Math.max(
      pool.selectedIndices.length ? 10 : 0,
      Math.min(10, Number(sessionStorage.getItem(storageKey)) || 0)
    )
  );
  const [building, setBuilding] = useState(
    () =>
      pool.selectedIndices.length > 0 || sessionStorage.getItem(`${storageKey}:building`) === '1'
  );
  const [selected, setSelected] = useState<readonly number[]>(pool.selectedIndices);
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false);
  const selectedRef = useRef(selected);
  const [saveFailed, setSaveFailed] = useState(false);
  const [group, setGroup] = useState('');
  const [cost, setCost] = useState('');
  const [rare, setRare] = useState('');
  const [sort, setSort] = useState<MemberSort>('COST_ASC');
  const [tab, setTab] = useState<'POOL' | 'DECK'>('POOL');
  const [detail, setDetail] = useState<PoolCard | null>(null);
  const [showLives, setShowLives] = useState(false);
  const [confirmExit, setConfirmExit] = useState(false);
  const [exiting, setExiting] = useState(false);
  const confirmed = table.members.find((member) => member.userId === userId)?.confirmed === true;
  const remaining = Math.max(0, Math.ceil(((table.confirmationExpiresAt ?? now) - now) / 1000));
  const groups = [...new Set(pool.cards.flatMap((card) => card.groupNames))];
  const costs = [
    ...new Set(pool.cards.flatMap((card) => (card.cost === null ? [] : [card.cost]))),
  ].sort((a, b) => a - b);
  const rares = [
    ...new Set(
      pool.cards.filter((card) => card.cardType === CardType.MEMBER).map((card) => card.rare)
    ),
  ];
  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return;
      event.preventDefault();
      event.returnValue = '';
    };
    const beforeLeave = (event: Event) => {
      if (
        dirtyRef.current &&
        !window.confirm('还有未保存的选牌，离开后这些修改可能丢失。确定离开吗？')
      ) {
        event.preventDefault();
      }
    };
    window.addEventListener('beforeunload', beforeUnload);
    window.addEventListener(SEALED_DRAFT_LEAVE_EVENT, beforeLeave);
    return () => {
      window.removeEventListener('beforeunload', beforeUnload);
      window.removeEventListener(SEALED_DRAFT_LEAVE_EVENT, beforeLeave);
    };
  }, [dirty]);
  useEffect(() => {
    if (!dirtyRef.current) {
      setSelected(pool.selectedIndices);
      selectedRef.current = pool.selectedIndices;
    }
  }, [pool.draftRevision, pool.selectedIndices]);
  useEffect(() => {
    if (!dirty || busy || confirmed || saveFailed) return;
    const timer = window.setTimeout(() => {
      const indices = [...selectedRef.current];
      void mutate('sealed/draft', { target: table, draftRevision: pool.draftRevision, indices })
        .then(() => {
          if (JSON.stringify(selectedRef.current) === JSON.stringify(indices)) {
            dirtyRef.current = false;
            setDirty(false);
          }
        })
        .catch(() => setSaveFailed(true));
    }, 350);
    return () => window.clearTimeout(timer);
  }, [dirty, busy, confirmed, saveFailed, selected, pool.draftRevision, mutate, table]);
  function reveal(count: number, startBuilding = false) {
    setOpened(count);
    sessionStorage.setItem(storageKey, String(count));
    if (startBuilding) {
      setBuilding(true);
      sessionStorage.setItem(`${storageKey}:building`, '1');
    }
  }
  function toggle(card: PoolCard) {
    if (confirmed || card.cardType !== CardType.MEMBER) return;
    const next = selected.includes(card.index)
      ? selected.filter((index) => index !== card.index)
      : selected.length < 24
        ? [...selected, card.index].sort((a, b) => a - b)
        : selected;
    if (next === selected) return;
    dirtyRef.current = true;
    selectedRef.current = next;
    setSelected(next);
    setDirty(true);
    setSaveFailed(false);
  }
  function cardTile(card: PoolCard, selectable: boolean) {
    const chosen = selected.includes(card.index);
    return (
      <article className={`sealed-card${chosen ? ' sealed-card--selected' : ''}`} key={card.index}>
        <button
          type="button"
          className="sealed-card-select"
          onClick={() => (selectable ? toggle(card) : setDetail(card))}
          aria-label={`${selectable ? '选择' : '查看'} ${card.name} ${card.rare}`}
          aria-pressed={selectable ? chosen : undefined}
          disabled={selectable && (confirmed || (!chosen && selected.length >= 24))}
        >
          <span className="sealed-card-art">
            <PresentationImage src={resolveCardImagePath(card)} alt="" loading="lazy" />
          </span>
          <span className="sealed-card-caption">
            <span>{card.name}</span>
            <small>
              {card.rare}
              {card.cost !== null
                ? ` · 费用 ${card.cost}`
                : card.score !== null
                  ? ` · 分数 ${card.score}`
                  : ''}
            </small>
          </span>
        </button>
        {selectable && (
          <button
            type="button"
            className="sealed-card-zoom"
            aria-label={`查看 ${card.name} ${card.rare}`}
            title="查看卡牌详情"
            onClick={() => setDetail(card)}
          >
            <ZoomIn size={18} aria-hidden="true" />
          </button>
        )}
      </article>
    );
  }
  const members = pool.cards
    .filter(
      (card) =>
        card.cardType === CardType.MEMBER &&
        (!group || card.groupNames.includes(group)) &&
        (!cost || card.cost === Number(cost)) &&
        (!rare || card.rare === rare) &&
        (tab === 'POOL' || selected.includes(card.index))
    )
    .sort((a, b) => {
      let order = 0;
      if (sort === 'COST_ASC' || sort === 'COST_DESC') {
        // Unknown costs stay last in either direction; ties retain the opening order.
        if (a.cost === null && b.cost !== null) return 1;
        if (b.cost === null && a.cost !== null) return -1;
        order = ((a.cost ?? 0) - (b.cost ?? 0)) * (sort === 'COST_ASC' ? 1 : -1);
      } else if (sort === 'CARD_CODE') {
        order = a.cardCode.localeCompare(b.cardCode, 'en', { numeric: true });
      }
      return order || a.index - b.index;
    });
  const fixed = pool.cards.filter((card) => card.cardType !== CardType.MEMBER);
  const lives = fixed.filter((card) => card.cardType === CardType.LIVE);
  const selectedMembers = pool.cards.filter((card) => selected.includes(card.index));
  const costDistribution = [...new Set(selectedMembers.map((card) => card.cost))]
    .sort((a, b) => (a ?? Infinity) - (b ?? Infinity))
    .map((value) => ({
      cost: value,
      count: selectedMembers.filter((card) => card.cost === value).length,
    }));
  const maxCostCount = Math.max(1, ...costDistribution.map((bucket) => bucket.count));
  const hasFilters = Boolean(group || cost || rare);
  return (
    <section className="sealed-builder" aria-label="开盒战组牌">
      <div className="sealed-build-toolbar">
        <div className="sealed-build-counts">
          <div
            className={`sealed-member-count${selected.length === 24 ? ' sealed-member-count--complete' : ''}`}
          >
            <span>已选成员</span>
            <strong>
              {selected.length}
              <small>/24</small>
            </strong>
          </div>
          <button
            type="button"
            className="sealed-live-count"
            disabled={!building}
            title={building ? '查看本局固定 Live' : '进入组牌后查看本局固定 Live'}
            onClick={() => setShowLives(true)}
            aria-haspopup="dialog"
          >
            <Check size={14} aria-hidden="true" />
            Live 6/6
            <ChevronDown size={13} aria-hidden="true" />
          </button>
        </div>
        <div className="sealed-build-actions">
          <span
            className={`sealed-deadline${remaining <= 60 ? ' sealed-deadline--urgent' : ''}`}
            aria-label="组牌剩余时间"
          >
            <Clock3 size={17} aria-hidden="true" />
            {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, '0')}
          </span>
          <ActionButton
            disabled={busy || dirty || selected.length !== 24 || remaining === 0}
            onClick={() =>
              void mutate('sealed/ready', {
                target: table,
                draftRevision: pool.draftRevision,
                ready: !confirmed,
              }).catch(() => undefined)
            }
          >
            {confirmed ? '取消准备' : '准备对战'}
          </ActionButton>
        </div>
      </div>
      <div className="sealed-build-meta">
        <p className="sealed-save-status" role="status">
          {confirmed
            ? '你已准备，等待对手。'
            : saveFailed
              ? '草稿保存失败，请重试。'
              : dirty
                ? '正在保存草稿…'
                : '已自动保存'}
          {' · '}
          {table.members
            .filter((member) => member.userId !== userId)
            .map((member) => `对手${member.confirmed ? '已准备' : '组牌中'}`)
            .join(' ')}
        </p>
        <div className="sealed-meta-actions">
          <details
            className="sealed-info"
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.currentTarget.open = false;
                event.currentTarget.querySelector('summary')?.focus();
              }
            }}
          >
            <summary>
              <Info size={14} aria-hidden="true" />
              房间与规则
              <ChevronDown size={13} aria-hidden="true" />
            </summary>
            <div className="sealed-info-content">
              <div className="sealed-info-room">
                <strong>本局房间</strong>
                {roomCodeAction}
              </div>
              <p>{table.members.map((member) => member.displayName).join(' · ')}</p>
              <p>
                选择 24 张成员，本盒 6 张 Live 自动加入，能量自动补足 12
                张。印刷必要心视为灰心，两首 Live 获胜。
              </p>
              <p>
                点击卡牌选入或移出，点放大镜查看详情。15
                分钟内双方完成准备，超时取消本轮、不记败北。
              </p>
              <small>模拟封入，非官方概率。</small>
            </div>
          </details>
          <ActionButton
            variant="ghost"
            size="compact"
            disabled={busy}
            onClick={() => setConfirmExit(true)}
          >
            退出本轮
          </ActionButton>
        </div>
      </div>
      {saveFailed && (
        <button className="button-secondary" disabled={busy} onClick={() => setSaveFailed(false)}>
          重试保存
        </button>
      )}
      {error && (
        <p className="casual-error" role="alert">
          {error}
        </p>
      )}
      {!building ? (
        <>
          <div className="sealed-opening">
            <div>
              <h3>已开 {opened}/10 包</h3>
              <p>模拟封入，非官方概率</p>
            </div>
            {opened < 10 ? (
              <>
                <button className="button-primary" onClick={() => reveal(opened + 1)}>
                  打开第 {opened + 1} 包
                </button>
                <button className="button-secondary" onClick={() => reveal(10, true)}>
                  全部打开并组牌
                </button>
              </>
            ) : (
              <button className="button-primary" onClick={() => reveal(10, true)}>
                开始组牌
              </button>
            )}
          </div>
          <div className="sealed-card-grid">
            {pool.cards
              .filter((card) => opened > 0 && Math.floor(card.index / 5) === opened - 1)
              .map((card) => cardTile(card, false))}
          </div>
        </>
      ) : (
        <>
          <div className="sealed-filters">
            <div className="sealed-pool-tabs" role="group" aria-label="查看牌池或卡组">
              <button aria-pressed={tab === 'POOL'} onClick={() => setTab('POOL')}>
                成员牌池{' '}
                <span>{pool.cards.filter((card) => card.cardType === CardType.MEMBER).length}</span>
              </button>
              <button aria-pressed={tab === 'DECK'} onClick={() => setTab('DECK')}>
                已选成员 <span>{selected.length}</span>
              </button>
            </div>
            <div className="sealed-filter-menus" role="group" aria-label="筛选与排序">
              <SelectMenu
                label="团体"
                value={group}
                onChange={setGroup}
                className="sealed-filter-menu"
                options={[
                  { value: '', label: '全部团体' },
                  ...groups.map((value) => ({ value, label: getGroupDisplayName(value) })),
                ]}
              />
              <SelectMenu
                label="费用"
                value={cost}
                onChange={setCost}
                className="sealed-filter-menu"
                menuMinWidth={144}
                options={[
                  { value: '', label: '全部费用' },
                  ...costs.map((value) => ({ value: String(value), label: `费用 ${value}` })),
                ]}
              />
              <SelectMenu
                label="罕度"
                value={rare}
                onChange={setRare}
                className="sealed-filter-menu"
                menuMinWidth={144}
                options={[
                  { value: '', label: '全部罕度' },
                  ...rares.map((value) => ({ value, label: value })),
                ]}
              />
              <SelectMenu<MemberSort>
                label="排序"
                value={sort}
                onChange={setSort}
                className="sealed-filter-menu sealed-sort-menu"
                menuMinWidth={176}
                options={MEMBER_SORT_OPTIONS.map((option) => ({
                  ...option,
                  leading: <ArrowDownUp size={14} aria-hidden="true" />,
                }))}
              />
            </div>
          </div>
          <div className="sealed-filter-feedback">
            <div className="sealed-filter-status">
              <span role="status">
                当前展示 {members.length} /{' '}
                {tab === 'DECK'
                  ? selected.length
                  : pool.cards.filter((card) => card.cardType === CardType.MEMBER).length}{' '}
                张{hasFilters ? ' · 已筛选' : ''}
              </span>
              {hasFilters && (
                <ActionButton
                  variant="ghost"
                  size="compact"
                  onClick={() => {
                    setGroup('');
                    setCost('');
                    setRare('');
                  }}
                >
                  <RotateCcw size={13} aria-hidden="true" />
                  重置筛选
                </ActionButton>
              )}
            </div>
            {tab === 'DECK' && (
              <details className="sealed-cost-summary">
                <summary>
                  <ChartColumn size={15} aria-hidden="true" />
                  费用分布<span>全部已选 {selected.length} 张</span>
                  <ChevronDown size={14} aria-hidden="true" />
                </summary>
                {selected.length ? (
                  <ul className="sealed-cost-chart" aria-label="已选成员费用分布">
                    {costDistribution.map((bucket) => (
                      <li
                        key={bucket.cost ?? 'unknown'}
                        aria-label={`${bucket.cost === null ? '未知费用' : `费用 ${bucket.cost}`}：${bucket.count} 张`}
                      >
                        <strong>
                          {bucket.count}
                          <small> 张</small>
                        </strong>
                        <span className="sealed-cost-bar-track" aria-hidden="true">
                          <span style={{ height: `${(bucket.count / maxCostCount) * 100}%` }} />
                        </span>
                        <span>{bucket.cost ?? '未知'}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>选择成员后，这里会显示费用分布。</p>
                )}
                <small>按全部已选成员统计，不受当前筛选影响。</small>
              </details>
            )}
          </div>
          <div className="sealed-card-grid">{members.map((card) => cardTile(card, true))}</div>
          {!members.length && <p>当前筛选下没有成员卡。</p>}
          <details className="sealed-fixed">
            <summary>固定加入的 6 张 Live 与 {fixed.length - 6} 张能量</summary>
            <div className="sealed-card-grid">{fixed.map((card) => cardTile(card, false))}</div>
          </details>
        </>
      )}
      {showLives && (
        <SealedPanel title="本局固定 Live" onClose={() => setShowLives(false)} wide>
          <p className="sealed-live-note">
            这 6 张 Live 自动加入卡组。以下为印刷需求转灰后的基础需求；对战中的卡效增减另行计算。
          </p>
          <div className="sealed-live-list">
            {lives.map((card) => (
              <article className="sealed-live-preview" key={card.index}>
                <button
                  className="sealed-live-image"
                  aria-label={`查看 ${card.name} ${card.rare}`}
                  onClick={() => setDetail(card)}
                >
                  <PresentationImage src={resolveCardImagePath(card)} alt="" />
                  <ZoomIn size={14} aria-hidden="true" />
                </button>
                <div>
                  <strong>{card.name}</strong>
                  <LiveFacts card={card} />
                  <p>{card.cardText || '无卡文'}</p>
                </div>
              </article>
            ))}
          </div>
        </SealedPanel>
      )}
      {detail && (
        <SealedPanel title={detail.name} onClose={() => setDetail(null)}>
          <div className="sealed-card-detail">
            <PresentationImage src={resolveCardImagePath(detail)} alt={detail.name} />
            {detail.cardType === CardType.LIVE && (
              <>
                <LiveFacts card={detail} />
                <small>基础需求已转灰，对战时另行计算卡效增减；原卡面保持不变。</small>
              </>
            )}
            <p>{detail.cardText || '无卡文'}</p>
          </div>
        </SealedPanel>
      )}
      <ConfirmDialog
        isOpen={confirmExit}
        title="退出本轮开盒战？"
        message="退出会取消双方本轮开盒战，本轮牌池和组牌进度将无法继续使用，不记作对局败北。"
        confirmLabel="确认退出"
        cancelLabel="继续组牌"
        isConfirming={busy || exiting}
        onCancel={() => setConfirmExit(false)}
        onConfirm={() => {
          if (busy || exiting) return;
          setExiting(true);
          void mutate('cancel', { target: table }).catch(() => {
            setExiting(false);
            setConfirmExit(false);
          });
        }}
      />
    </section>
  );
}

function LiveFacts({ card }: { card: PoolCard }) {
  return (
    <div className="sealed-live-facts">
      <span>
        分数 <strong>{card.score}</strong>
      </span>
      <span>
        <Heart size={14} fill="currentColor" aria-hidden="true" />
        灰心需求 <strong>{card.baseRequiredHearts}</strong>
      </span>
    </div>
  );
}

function SealedPanel({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogAccessibility({ isOpen: true, dialogRef, onEscape: onClose });
  return createPortal(
    <div className="sealed-detail" onClick={onClose}>
      <div
        ref={dialogRef}
        className={`modal-surface sealed-panel${wide ? ' sealed-panel--wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="sealed-panel-header">
          <h3>{title}</h3>
          <button type="button" className="button-icon" aria-label="关闭详情" onClick={onClose}>
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <div className="sealed-panel-content">{children}</div>
      </div>
    </div>,
    getPresentationPortalRoot()
  );
}

export function SealedRematchControls({
  table,
  userId,
  now,
}: {
  table: CasualTableOwnView;
  userId: string;
  now: number;
}) {
  const mutate = useCasualTableStore((state) => state.mutate);
  const busy = useCasualTableStore((state) => state.busy);
  const request =
    table.sealedRematch && table.sealedRematch.expiresAt > now ? table.sealedRematch : null;
  if (!table.canRematch) return null;
  const send = (path: string, body: object) =>
    void mutate(path, { target: table, ...body }).catch(() => undefined);
  return (
    <div className="casual-actions sealed-rematch">
      {request ? (
        <>
          <p>
            {request.requesterUserId === userId ? '等待对手回应：' : '对手邀请：'}
            {request.kind === 'REBOX' ? '双方重新开盒' : '原牌池重新组牌'}
          </p>
          {request.requesterUserId !== userId && (
            <button
              className="button-primary"
              disabled={busy}
              onClick={() =>
                send('sealed/rematch/respond', { requestId: request.requestId, accept: true })
              }
            >
              同意
            </button>
          )}
          <button
            className="button-secondary"
            disabled={busy}
            onClick={() =>
              send('sealed/rematch/respond', { requestId: request.requestId, accept: false })
            }
          >
            {request.requesterUserId === userId ? '撤回邀请' : '拒绝'}
          </button>
        </>
      ) : (
        <>
          <button
            className="button-primary"
            disabled={busy}
            onClick={() =>
              send('sealed/rematch/request', { requestId: crypto.randomUUID(), kind: 'SAME_POOL' })
            }
          >
            原牌池再战
          </button>
          <button
            className="button-secondary"
            disabled={busy}
            onClick={() =>
              send('sealed/rematch/request', { requestId: crypto.randomUUID(), kind: 'REBOX' })
            }
          >
            邀请重新开盒
          </button>
        </>
      )}
    </div>
  );
}

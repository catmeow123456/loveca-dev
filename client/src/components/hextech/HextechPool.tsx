import { useId, useRef, useState, type RefObject } from 'react';
import { ArrowLeft, Search, X } from 'lucide-react';
import { ActionButton, DialogShell, Tabs, TextInput } from '@/components/common';
import {
  HEXTECH_DEFINITIONS,
  HEXTECH_RARITY_LABELS,
  type HextechRarity,
} from '@game/domain/hextech/catalog';
import './hextech-pool.css';

const RARITIES = ['SILVER', 'GOLD', 'PRISMATIC'] as const;
type RarityFilter = 'ALL' | HextechRarity;
const OPTIONS = [
  { value: 'ALL', label: '全部' },
  ...RARITIES.map((value) => ({ value, label: `${HEXTECH_RARITY_LABELS[value]}色` })),
] as const;
const DRAW_KINDS = new Set(['ACQUIRE_DRAW', 'ACQUIRE_AND_TURN_DRAW', 'ACTIVATED_DISCARD_DRAW']);

/** Public rules only; this reader does not consume a match or submit commands. */
export function HextechPool({
  onClose,
  presentation = 'dialog',
  returnFocusRef,
}: {
  onClose: () => void;
  presentation?: 'dialog' | 'page';
  returnFocusRef?: RefObject<HTMLElement | null>;
}) {
  const id = useId();
  const panelId = `${id}-results`;
  const [rarity, setRarity] = useState<RarityFilter>('ALL');
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const term = query.trim().toLocaleLowerCase();
  const matches = HEXTECH_DEFINITIONS.filter(
    (item) =>
      (rarity === 'ALL' || item.rarity === rarity) &&
      `${item.name} ${item.rulesText} ${DRAW_KINDS.has(item.effect.kind) ? '抽牌' : ''}`
        .toLocaleLowerCase()
        .includes(term)
  );
  const total = HEXTECH_DEFINITIONS.length;
  const scrollToTop = () => resultsRef.current?.scrollTo({ top: 0 });
  const closeSearch = () => {
    setSearchOpen(false);
    setQuery('');
    scrollToTop();
    toggleRef.current?.focus();
  };
  const title = (
    <>
      海克斯池
      <span className="hextech-pool-count" aria-hidden="true">
        {matches.length === total ? total : `${matches.length}/${total}`}
      </span>
    </>
  );
  const tabs = (
    <Tabs<RarityFilter>
      id={id}
      panelId={panelId}
      label="海克斯稀有度"
      value={rarity}
      options={OPTIONS}
      variant="underline"
      className="hextech-pool-tabs"
      onChange={(value) => {
        setRarity(value);
        scrollToTop();
      }}
    />
  );
  const searchButton = (
    <ActionButton
      ref={toggleRef}
      variant="icon"
      aria-label={searchOpen ? '收起海克斯搜索' : '搜索海克斯'}
      aria-expanded={searchOpen}
      aria-controls={`${id}-search`}
      onClick={() => {
        if (searchOpen) closeSearch();
        else setSearchOpen(true);
      }}
    >
      <Search size={18} aria-hidden="true" />
    </ActionButton>
  );
  const search = searchOpen ? (
    <div className="hextech-pool-search" id={`${id}-search`}>
      <Search size={16} aria-hidden="true" />
      <TextInput
        ref={searchRef}
        autoFocus
        type="search"
        aria-label="搜索海克斯名称或效果"
        placeholder="搜索名称或效果"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          scrollToTop();
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            closeSearch();
          }
        }}
      />
      {query && (
        <ActionButton
          variant="icon"
          aria-label="清空海克斯搜索"
          onClick={() => {
            setQuery('');
            searchRef.current?.focus();
            scrollToTop();
          }}
        >
          <X size={15} aria-hidden="true" />
        </ActionButton>
      )}
    </div>
  ) : null;
  const content = (
    <div
      ref={resultsRef}
      id={panelId}
      className="hextech-pool-results"
      role="tabpanel"
      aria-labelledby={`${id}-${rarity}`}
      tabIndex={0}
      data-filtered={rarity !== 'ALL'}
    >
      <span className="sr-only" role="status" aria-live="polite">
        显示 {matches.length} 项，共 {total} 项海克斯
      </span>
      {matches.length === 0 ? (
        <div className="hextech-pool-empty">
          <h3>没有找到匹配的海克斯</h3>
          <ActionButton
            variant="ghost"
            onClick={() => {
              setRarity('ALL');
              setQuery('');
              searchRef.current?.focus();
            }}
          >
            查看全部海克斯
          </ActionButton>
        </div>
      ) : (
        RARITIES.map((tier) => {
          const items = matches
            .filter((item) => item.rarity === tier)
            .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
          if (!items.length) return null;
          return (
            <section key={tier} className="hextech-pool-group">
              <h3 className="hextech-pool-group-title">{HEXTECH_RARITY_LABELS[tier]}色</h3>
              <div className="hextech-pool-grid">
                {items.map((item) => (
                  <article key={item.id} className="hextech-pool-item" data-rarity={tier}>
                    <header>
                      <h4>{item.name}</h4>
                      <span className="hextech-pool-rarity">{HEXTECH_RARITY_LABELS[tier]}色</span>
                    </header>
                    {item.effect.kind === 'ACQUIRE_DRAW' && <small>取得时</small>}
                    <p>{item.rulesText}</p>
                  </article>
                ))}
              </div>
            </section>
          );
        })
      )}
    </div>
  );
  if (presentation === 'page') {
    return (
      <main className="hextech-pool-page">
        <header className="hextech-pool-header">
          <div>
            <h1>{title}</h1>
          </div>
          {tabs}
          {searchButton}
          <ActionButton variant="icon" aria-label="返回首页" onClick={onClose}>
            <ArrowLeft size={18} aria-hidden="true" />
          </ActionButton>
        </header>
        {search}
        {content}
      </main>
    );
  }
  return (
    <DialogShell
      isOpen
      title={title}
      onClose={onClose}
      closeLabel="关闭海克斯池"
      size="wide"
      className="hextech-pool-dialog"
      headerNavigation={tabs}
      headerActions={searchButton}
      navigation={search}
      returnFocusRef={returnFocusRef}
    >
      {content}
    </DialogShell>
  );
}

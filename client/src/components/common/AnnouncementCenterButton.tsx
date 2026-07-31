import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Bell, X } from 'lucide-react';
import type {
  PublicSiteAnnouncement,
  PublicSiteStatus,
  SiteAnnouncementType,
  SiteStatusLifecycle,
} from '@/lib/appConfig';
import { buildAnnouncementUnreadKey } from '@/lib/appConfig';
import { cn } from '@/lib/utils';

const ANNOUNCEMENT_SEEN_STORAGE_KEY = 'loveca.home.announcements.seen.v1';
const ANNOUNCEMENT_SEEN_EVENT = 'loveca:announcement-seen';

const LIFECYCLE_LABELS: Record<SiteStatusLifecycle, string> = {
  NORMAL: '正常',
  SCHEDULED: '计划维护',
  RESTRICTING_NEW_GAMES: '限制新开局',
  MAINTENANCE: '维护中',
  COMPLETED: '已完成',
  POSTPONED: '已延期',
  CANCELLED: '已取消',
};

const ANNOUNCEMENT_TYPE_LABELS: Record<SiteAnnouncementType, string> = {
  MAINTENANCE: '维护',
  UPDATE: '更新',
  NEWS: '动态',
};

interface AnnouncementDisplayItem {
  id: string;
  label: string;
  title: string;
  summary: string;
  detail: string | null;
  timestamp: string | null;
  timestampLabel: '开始' | '发布';
  endsAt: string | null;
  impactScopes: readonly string[];
  action: string | null;
  tone: 'default' | 'info' | 'warning';
}

interface AnnouncementCenterButtonProps {
  siteStatus: PublicSiteStatus;
  className?: string;
  iconSize?: number;
  indicatorClassName?: string;
  label?: ReactNode;
}

export function AnnouncementCenterButton({
  siteStatus,
  className,
  iconSize = 16,
  indicatorClassName,
  label,
}: AnnouncementCenterButtonProps) {
  const items = useMemo(() => buildAnnouncementDisplayItems(siteStatus), [siteStatus]);
  const unreadKey = useMemo(() => buildAnnouncementUnreadKey(siteStatus), [siteStatus]);
  const [isOpen, setIsOpen] = useState(false);
  const [lastSeenKey, setLastSeenKey] = useState(readAnnouncementSeenKey);
  const hasUnread = Boolean(unreadKey && items.length > 0 && lastSeenKey !== unreadKey);

  useEffect(() => {
    const handleSeen = (event: Event) => {
      const nextKey = (event as CustomEvent<string>).detail;
      if (nextKey) setLastSeenKey(nextKey);
    };
    window.addEventListener(ANNOUNCEMENT_SEEN_EVENT, handleSeen);
    return () => window.removeEventListener(ANNOUNCEMENT_SEEN_EVENT, handleSeen);
  }, []);

  const open = useCallback(() => {
    setIsOpen(true);
    if (!unreadKey) return;
    writeAnnouncementSeenKey(unreadKey);
    setLastSeenKey(unreadKey);
  }, [unreadKey]);
  const close = useCallback(() => setIsOpen(false), []);

  return (
    <>
      <button
        type="button"
        onClick={open}
        className={cn('button-icon relative', className)}
        title="公告"
        aria-label={
          hasUnread ? `公告，${items.length} 条内容有更新` : `公告，${items.length} 条内容`
        }
      >
        {label ?? <Bell size={iconSize} aria-hidden="true" />}
        {hasUnread ? (
          <span
            className={cn(
              'absolute right-1.5 top-1.5 h-2 w-2 rounded-full border border-[var(--bg-surface)] bg-[var(--semantic-warning)]',
              indicatorClassName
            )}
            aria-hidden="true"
          />
        ) : null}
      </button>
      {createPortal(
        <AnnouncementCenterDrawer isOpen={isOpen} items={items} onClose={close} />,
        document.body
      )}
      <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {hasUnread ? '公告已更新' : ''}
      </span>
    </>
  );
}

function AnnouncementCenterDrawer({
  isOpen,
  items,
  onClose,
}: {
  isOpen: boolean;
  items: readonly AnnouncementDisplayItem[];
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const previouslyFocusedElementRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    const previousOverflow = document.body.style.overflow;
    previouslyFocusedElementRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.style.overflow = 'hidden';
    const focusFrame = window.requestAnimationFrame(() => closeButtonRef.current?.focus());

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
        return;
      }
      if (event.key === 'Tab' && dialogRef.current) {
        trapFocusInDialog(event, dialogRef.current);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
      const previousElement = previouslyFocusedElementRef.current;
      previouslyFocusedElementRef.current = null;
      if (previousElement && document.contains(previousElement)) previousElement.focus();
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center bg-black/45 px-0 backdrop-blur-[2px] sm:items-center sm:px-4"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="announcement-center-title"
        tabIndex={-1}
        className="safe-bottom flex max-h-[88dvh] w-full flex-col overflow-hidden rounded-t-[24px] border border-b-0 border-[var(--border-default)] bg-[var(--bg-surface)] shadow-[var(--shadow-lg)] sm:max-w-2xl sm:rounded-xl sm:border"
      >
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <h2
              id="announcement-center-title"
              className="text-base font-bold text-[var(--text-primary)]"
            >
              公告
            </h2>
            <p className="mt-0.5 text-xs leading-5 text-[var(--text-muted)]">
              {items.length > 0
                ? `${items.length} 条维护、更新与动态`
                : `当前版本 ${__APP_VERSION__}`}
            </p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            className="button-icon h-9 w-9 shrink-0"
            onClick={onClose}
            aria-label="关闭公告"
            title="关闭公告"
          >
            <X size={16} />
          </button>
        </header>

        <div className="touch-scroll overflow-y-auto px-4 sm:px-5">
          {items.length > 0 ? (
            <div className="divide-y divide-[var(--border-subtle)]">
              {items.map((item) => (
                <AnnouncementDetailRow key={item.id} item={item} />
              ))}
            </div>
          ) : (
            <div className="py-10 text-center">
              <Bell className="mx-auto text-[var(--text-muted)]" size={20} />
              <h3 className="mt-3 text-sm font-bold text-[var(--text-primary)]">暂无公告</h3>
              <p className="mt-1 text-sm text-[var(--text-secondary)]">
                新的维护安排、版本更新和动态会显示在这里。
              </p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function AnnouncementDetailRow({ item }: { item: AnnouncementDisplayItem }) {
  const metaParts = [
    item.timestamp ? `${item.timestampLabel} ${formatStatusDateTime(item.timestamp)}` : null,
    item.endsAt ? `结束 ${formatStatusDateTime(item.endsAt)}` : null,
    item.impactScopes.length > 0 ? `影响 ${item.impactScopes.join('、')}` : null,
  ].filter((part): part is string => part !== null);
  const toneClass = {
    default: 'text-[var(--accent-primary)]',
    info: 'text-[var(--semantic-info)]',
    warning: 'text-[var(--semantic-warning)]',
  }[item.tone];

  return (
    <article className="py-4">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span className={cn('text-[11px] font-bold', toneClass)}>{item.label}</span>
        <h3 className="min-w-0 text-sm font-bold leading-5 text-[var(--text-primary)]">
          {item.title}
        </h3>
        {item.action ? (
          <span className="ml-auto text-[11px] font-semibold text-[var(--text-secondary)]">
            {item.action}
          </span>
        ) : null}
      </div>
      <p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">{item.summary}</p>
      {item.detail ? (
        <p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-[var(--text-muted)]">
          {item.detail}
        </p>
      ) : null}
      {metaParts.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] leading-5 text-[var(--text-muted)]">
          {metaParts.map((part) => (
            <span key={part}>{part}</span>
          ))}
        </div>
      ) : null}
    </article>
  );
}

function buildAnnouncementDisplayItems(siteStatus: PublicSiteStatus): AnnouncementDisplayItem[] {
  const items: AnnouncementDisplayItem[] = [];
  const maintenance = siteStatus.maintenance;
  if (maintenance) {
    const isBlocking =
      siteStatus.lifecycle === 'MAINTENANCE' || siteStatus.lifecycle === 'RESTRICTING_NEW_GAMES';
    items.push({
      id: `maintenance:${maintenance.updatedAt}`,
      label: LIFECYCLE_LABELS[siteStatus.lifecycle],
      title: maintenance.title,
      summary: maintenance.summary,
      detail: maintenance.detail,
      timestamp: maintenance.startsAt,
      timestampLabel: '开始',
      endsAt: maintenance.estimatedEndsAt,
      impactScopes: maintenance.impactScopes,
      action: maintenance.action,
      tone: isBlocking ? 'warning' : 'info',
    });
  }

  for (const announcement of siteStatus.announcements) {
    items.push(buildAnnouncementDisplayItem(announcement));
  }
  return items;
}

function buildAnnouncementDisplayItem(
  announcement: PublicSiteAnnouncement
): AnnouncementDisplayItem {
  return {
    id: `announcement:${announcement.id}`,
    label: ANNOUNCEMENT_TYPE_LABELS[announcement.type],
    title: announcement.title,
    summary: announcement.summary,
    detail: announcement.detail,
    timestamp: announcement.startsAt ?? announcement.publishedAt,
    timestampLabel: announcement.startsAt ? '开始' : '发布',
    endsAt: announcement.endsAt,
    impactScopes: announcement.impactScopes,
    action: null,
    tone: announcement.type === 'MAINTENANCE' ? 'warning' : 'default',
  };
}

function formatStatusDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function readAnnouncementSeenKey(): string | null {
  try {
    return window.localStorage.getItem(ANNOUNCEMENT_SEEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeAnnouncementSeenKey(value: string): void {
  try {
    window.localStorage.setItem(ANNOUNCEMENT_SEEN_STORAGE_KEY, value);
  } catch {
    // 公告仍可正常查看；存储不可用时只是不记录已读状态。
  }
  window.dispatchEvent(new CustomEvent<string>(ANNOUNCEMENT_SEEN_EVENT, { detail: value }));
}

const DIALOG_FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function trapFocusInDialog(event: KeyboardEvent, dialog: HTMLElement): void {
  const focusableElements = Array.from(
    dialog.querySelectorAll<HTMLElement>(DIALOG_FOCUSABLE_SELECTOR)
  ).filter(
    (element) => !element.hasAttribute('disabled') && element.getAttribute('aria-hidden') !== 'true'
  );

  if (focusableElements.length === 0) {
    event.preventDefault();
    dialog.focus();
    return;
  }

  const firstElement = focusableElements[0];
  const lastElement = focusableElements[focusableElements.length - 1];
  const activeElement = document.activeElement;
  if (event.shiftKey && activeElement === firstElement) {
    event.preventDefault();
    lastElement.focus();
  } else if (!event.shiftKey && activeElement === lastElement) {
    event.preventDefault();
    firstElement.focus();
  }
}

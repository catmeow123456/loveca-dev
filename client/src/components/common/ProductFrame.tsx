import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { ProductHeader } from './ProductHeader';

export type ProductNavKey = 'home' | 'decks' | 'battle' | 'spectate' | 'history';

export interface ProductNavigationHandlers {
  onHome: () => void;
  onDecks: () => void;
  onBattle: () => void;
  onSpectate: () => void;
  onHistory: () => void;
}

interface ProductFrameProps {
  active: ProductNavKey | null;
  navigation: ProductNavigationHandlers;
  actions?: ReactNode;
  mobileMenuActions?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  title?: string;
  description?: string;
  backLabel?: string;
  onBack?: () => void;
  titleAction?: ReactNode;
  className?: string;
}

const NAV_ITEMS: ReadonlyArray<{
  key: ProductNavKey;
  label: string;
  handler: keyof ProductNavigationHandlers;
}> = [
  { key: 'home', label: '大厅', handler: 'onHome' },
  { key: 'decks', label: '卡组', handler: 'onDecks' },
  { key: 'battle', label: '对战', handler: 'onBattle' },
  { key: 'spectate', label: '观战', handler: 'onSpectate' },
  { key: 'history', label: '历史', handler: 'onHistory' },
];

export function ProductFrame({
  active,
  navigation,
  actions,
  mobileMenuActions,
  children,
  footer,
  title,
  description,
  backLabel,
  onBack,
  titleAction,
  className,
}: ProductFrameProps) {
  const navigate = (handler: keyof ProductNavigationHandlers) => {
    navigation[handler]();
  };

  return (
    <div className={cn('app-shell flex h-[100dvh] min-h-0 flex-col overflow-x-hidden', className)}>
      <ProductHeader
        brandAriaLabel="前往大厅"
        onBrandClick={() => navigate('onHome')}
        navigationKey={active ?? 'secondary'}
        navigation={
          <nav className="hidden items-stretch self-stretch md:flex" aria-label="主要导航">
            {NAV_ITEMS.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => navigate(item.handler)}
                className={cn('product-nav-item', active === item.key && 'product-nav-item-active')}
                aria-current={active === item.key ? 'page' : undefined}
              >
                {item.label}
              </button>
            ))}
          </nav>
        }
        actions={actions}
        mobileNavigation={
          <nav className="product-mobile-nav md:hidden" aria-label="移动端主要导航">
            <div className="mx-auto grid w-full max-w-[1440px] grid-cols-2 gap-px px-4 pb-3 sm:px-6">
              {NAV_ITEMS.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => navigate(item.handler)}
                  className={cn(
                    'product-mobile-nav-item',
                    active === item.key && 'product-mobile-nav-item-active'
                  )}
                  aria-current={active === item.key ? 'page' : undefined}
                >
                  {item.label}
                </button>
              ))}
              {mobileMenuActions ? (
                <div className="col-span-2 mt-2 border-t border-[var(--border-subtle)] pt-2">
                  {mobileMenuActions}
                </div>
              ) : null}
            </div>
          </nav>
        }
      />

      {title ? (
        <div className="product-titlebar relative z-20">
          <div className="mx-auto flex min-h-[76px] w-full max-w-[1440px] items-center gap-4 px-4 py-3 sm:px-6 lg:px-8">
            <div className="min-w-0 flex-1">
              {onBack && backLabel ? (
                <button type="button" onClick={onBack} className="product-back-link">
                  ← {backLabel}
                </button>
              ) : null}
              <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
                <h1 className="text-xl font-black tracking-[-0.025em] text-[var(--text-primary)] sm:text-2xl">
                  {title}
                </h1>
                {description ? (
                  <p className="text-sm text-[var(--text-secondary)]">{description}</p>
                ) : null}
              </div>
            </div>
            {titleAction ? <div className="shrink-0">{titleAction}</div> : null}
          </div>
        </div>
      ) : null}

      <div className="product-frame-content flex min-h-0 flex-1 flex-col overflow-y-auto">
        {children}
      </div>
      {footer}
    </div>
  );
}

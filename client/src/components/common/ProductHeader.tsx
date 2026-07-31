import { useState, type ReactNode } from 'react';
import { Menu, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ProductBrand } from './ProductBrand';

interface ProductHeaderProps {
  brandAriaLabel: string;
  brandHref?: string;
  onBrandClick?: () => void;
  navigation?: ReactNode;
  actions?: ReactNode;
  mobileNavigation?: ReactNode;
  navigationKey?: string;
  className?: string;
}

export function ProductHeader({
  brandAriaLabel,
  brandHref,
  onBrandClick,
  navigation,
  actions,
  mobileNavigation,
  navigationKey,
  className,
}: ProductHeaderProps) {
  const [menuState, setMenuState] = useState({ open: false, navigationKey });
  const menuOpen = menuState.open && menuState.navigationKey === navigationKey;
  const closeMenu = () => setMenuState({ open: false, navigationKey });

  return (
    <header className={cn('product-header safe-top relative z-30', className)}>
      <div className="product-header-inner">
        <ProductBrand ariaLabel={brandAriaLabel} href={brandHref} onClick={onBrandClick} />

        {navigation}

        <div className="product-header-actions">
          {actions}
          {mobileNavigation ? (
            <button
              type="button"
              className="button-icon md:!hidden"
              onClick={() => setMenuState({ open: !menuOpen, navigationKey })}
              aria-expanded={menuOpen}
              aria-controls="product-mobile-navigation"
              aria-label={menuOpen ? '关闭导航菜单' : '打开导航菜单'}
            >
              {menuOpen ? <X size={17} /> : <Menu size={17} />}
            </button>
          ) : null}
        </div>
      </div>

      {menuOpen && mobileNavigation ? (
        <div id="product-mobile-navigation" onClick={closeMenu}>
          {mobileNavigation}
        </div>
      ) : null}
    </header>
  );
}

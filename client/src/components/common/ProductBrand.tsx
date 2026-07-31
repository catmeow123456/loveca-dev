import { cn } from '@/lib/utils';

interface ProductBrandProps {
  ariaLabel: string;
  className?: string;
  href?: string;
  onClick?: () => void;
}

export function ProductBrand({ ariaLabel, className, href, onClick }: ProductBrandProps) {
  const content = (
    <>
      <img src="/icon.jpg" alt="" className="product-brand-mark" />
      <strong className="product-brand-wordmark">Loveca</strong>
    </>
  );
  const rootClassName = cn(
    'product-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]',
    className
  );

  if (href) {
    return (
      <a className={rootClassName} href={href} aria-label={ariaLabel}>
        {content}
      </a>
    );
  }

  if (!onClick) {
    return <div className={cn('product-brand', className)}>{content}</div>;
  }

  return (
    <button type="button" onClick={onClick} className={rootClassName} aria-label={ariaLabel}>
      {content}
    </button>
  );
}

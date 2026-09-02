import { cn } from '@/lib/utils';
import { LEGAL_DOCUMENT_LINKS, LEGAL_NOTICE_ZH } from '@/lib/legalPages';
import './legal-notice.css';

interface LegalNoticeProps {
  readonly className?: string;
  readonly version?: string;
}

export function LegalNotice({ className, version }: LegalNoticeProps) {
  return (
    <div className={cn('legal-notice', className)}>
      <p className="legal-notice__statement">
        <span>{LEGAL_NOTICE_ZH}</span>
        {version ? <span className="legal-notice__version">v{version}</span> : null}
      </p>
      <nav className="legal-notice__links" aria-label="法律与隐私">
        {LEGAL_DOCUMENT_LINKS.map((document, index) => (
          <span key={document.key}>
            {index > 0 ? <i aria-hidden="true">·</i> : null}
            <a href={document.href}>{document.label}</a>
          </span>
        ))}
      </nav>
    </div>
  );
}

export function SiteLegalFooter({ className }: { readonly className?: string }) {
  return (
    <footer className={cn('site-legal-footer', className)}>
      <LegalNotice />
    </footer>
  );
}

import { cn } from '@/lib/utils';
import {
  handleLegalDocumentNavigation,
  LEGAL_DOCUMENT_LINKS,
  LEGAL_NOTICE_ZH,
  type LegalDocumentKey,
} from '@/lib/legalPages';
import './legal-notice.css';

interface LegalNoticeProps {
  readonly className?: string;
  readonly version?: string;
}

interface LegalDocumentLinkProps {
  readonly document: (typeof LEGAL_DOCUMENT_LINKS)[number];
  readonly currentDocument?: LegalDocumentKey;
}

export function LegalDocumentLink({ document, currentDocument }: LegalDocumentLinkProps) {
  return (
    <a
      href={document.href}
      aria-current={currentDocument === document.key ? 'page' : undefined}
      onClick={(event) => handleLegalDocumentNavigation(event, document.href)}
    >
      {document.label}
    </a>
  );
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
            <LegalDocumentLink document={document} />
          </span>
        ))}
      </nav>
    </div>
  );
}

import type { HTMLAttributes, ReactNode } from 'react';
import { RefreshCw, TriangleAlert } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ActionButton } from './VisualPrimitives';
import './async-feedback.css';

type StateVariant = 'plain' | 'panel';

export interface LoadingStateProps extends HTMLAttributes<HTMLDivElement> {
  label: string;
  variant?: StateVariant;
}

export function LoadingState({ label, variant = 'plain', className, ...props }: LoadingStateProps) {
  return (
    <div
      role="status"
      className={cn('ui-feedback-state', `ui-feedback-state--${variant}`, className)}
      {...props}
    >
      <RefreshCw size={16} className="ui-feedback-spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export interface EmptyStateProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  variant?: StateVariant;
}

export function EmptyState({
  title,
  description,
  icon,
  action,
  variant = 'plain',
  className,
  ...props
}: EmptyStateProps) {
  return (
    <div className={cn('ui-feedback-state', `ui-feedback-state--${variant}`, className)} {...props}>
      <div className="ui-empty-state-content">
        {icon ? (
          <div className="ui-empty-state-icon" aria-hidden="true">
            {icon}
          </div>
        ) : null}
        <div className="ui-empty-state-title">{title}</div>
        {description ? <div className="ui-empty-state-description">{description}</div> : null}
        {action ? <div className="ui-empty-state-action">{action}</div> : null}
      </div>
    </div>
  );
}

export interface ErrorNoticeProps extends HTMLAttributes<HTMLDivElement> {
  message: ReactNode;
  onRetry?: () => void;
  retryLabel?: string;
  retryDisabled?: boolean;
}

export function ErrorNotice({
  message,
  onRetry,
  retryLabel = '重试',
  retryDisabled = false,
  className,
  ...props
}: ErrorNoticeProps) {
  return (
    <div role="alert" className={cn('ui-error-notice', className)} {...props}>
      <TriangleAlert size={16} className="ui-error-notice-icon" aria-hidden="true" />
      <span className="ui-error-notice-message">{message}</span>
      {onRetry ? (
        <ActionButton variant="ghost" onClick={onRetry} disabled={retryDisabled}>
          <RefreshCw size={14} aria-hidden="true" />
          {retryLabel}
        </ActionButton>
      ) : null}
    </div>
  );
}

import {
  forwardRef,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
} from 'react';
import { cn } from '@/lib/utils';

type PanelElement = 'section' | 'article' | 'aside' | 'div';
type PanelTone = 'surface' | 'muted' | 'frosted';
type PanelPadding = 'none' | 'compact' | 'default' | 'spacious';

export interface PanelProps extends HTMLAttributes<HTMLElement> {
  as?: PanelElement;
  tone?: PanelTone;
  padding?: PanelPadding;
}

export function Panel({
  as: Component = 'div',
  tone = 'surface',
  padding = 'default',
  className,
  ...props
}: PanelProps) {
  return (
    <Component
      className={cn('ui-panel', `ui-panel--${tone}`, `ui-panel--padding-${padding}`, className)}
      {...props}
    />
  );
}

export interface SectionHeadingProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  title: ReactNode;
  description?: ReactNode;
  eyebrow?: ReactNode;
  action?: ReactNode;
  level?: 2 | 3;
}

export function SectionHeading({
  title,
  description,
  eyebrow,
  action,
  level = 2,
  className,
  ...props
}: SectionHeadingProps) {
  const Heading = level === 2 ? 'h2' : 'h3';

  return (
    <div className={cn('ui-section-heading', className)} {...props}>
      <div className="min-w-0">
        {eyebrow ? <div className="ui-section-heading__eyebrow">{eyebrow}</div> : null}
        <Heading className="ui-section-heading__title">{title}</Heading>
        {description ? <p className="ui-section-heading__description">{description}</p> : null}
      </div>
      {action ? <div className="ui-section-heading__action">{action}</div> : null}
    </div>
  );
}

type ActionButtonVariant = 'primary' | 'secondary' | 'ghost' | 'icon';
type ActionButtonSize = 'compact' | 'default';

export interface ActionButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ActionButtonVariant;
  size?: ActionButtonSize;
}

const ACTION_BUTTON_VARIANT_CLASS: Record<ActionButtonVariant, string> = {
  primary: 'button-primary',
  secondary: 'button-secondary',
  ghost: 'button-ghost',
  icon: 'button-icon',
};

export const ActionButton = forwardRef<HTMLButtonElement, ActionButtonProps>(function ActionButton(
  { variant = 'primary', size = 'default', type = 'button', className, ...props },
  ref
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        'ui-action-button',
        ACTION_BUTTON_VARIANT_CLASS[variant],
        `ui-action-button--${size}`,
        variant === 'icon' && 'ui-action-button--icon',
        className
      )}
      {...props}
    />
  );
});

type StatusBadgeTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info';

export interface StatusBadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: StatusBadgeTone;
  dot?: boolean;
}

export function StatusBadge({
  tone = 'neutral',
  dot = false,
  className,
  children,
  ...props
}: StatusBadgeProps) {
  return (
    <span
      className={cn('status-pill ui-status-badge', `ui-status-badge--${tone}`, className)}
      {...props}
    >
      {dot ? <span className="ui-status-badge__dot" aria-hidden="true" /> : null}
      {children}
    </span>
  );
}

export interface TextInputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(function TextInput(
  { invalid = false, className, ...props },
  ref
) {
  return (
    <input
      ref={ref}
      className={cn('input-field ui-text-input', className)}
      aria-invalid={invalid || undefined}
      {...props}
    />
  );
});

import { useEffect, useEffectEvent, type RefObject } from 'react';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

let bodyScrollLockCount = 0;
let bodyOverflowBeforeLock = '';
const openDialogStack: symbol[] = [];

function lockBodyScroll(): () => void {
  if (bodyScrollLockCount === 0) {
    bodyOverflowBeforeLock = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  bodyScrollLockCount += 1;

  return () => {
    bodyScrollLockCount = Math.max(0, bodyScrollLockCount - 1);
    if (bodyScrollLockCount === 0) {
      document.body.style.overflow = bodyOverflowBeforeLock;
    }
  };
}

function getFocusableElements(dialog: HTMLElement): HTMLElement[] {
  return Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) => !element.hasAttribute('disabled') && element.getAttribute('aria-hidden') !== 'true'
  );
}

interface UseDialogAccessibilityOptions {
  readonly isOpen: boolean;
  readonly dialogRef: RefObject<HTMLElement | null>;
  readonly initialFocusRef?: RefObject<HTMLElement | null>;
  readonly onEscape?: () => void;
  readonly closeOnEscape?: boolean;
}

export function useDialogAccessibility({
  isOpen,
  dialogRef,
  initialFocusRef,
  onEscape,
  closeOnEscape = true,
}: UseDialogAccessibilityOptions): void {
  const handleEscape = useEffectEvent((): boolean => {
    if (!closeOnEscape || !onEscape) {
      return false;
    }
    onEscape();
    return true;
  });

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const dialogToken = Symbol('dialog');
    openDialogStack.push(dialogToken);
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const unlockBodyScroll = lockBodyScroll();
    const dialog = dialogRef.current;
    const focusTarget = initialFocusRef?.current ?? (dialog ? getFocusableElements(dialog)[0] : null);
    (focusTarget ?? dialog)?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (openDialogStack.at(-1) !== dialogToken) {
        return;
      }
      const currentDialog = dialogRef.current;
      if (!currentDialog) {
        return;
      }

      if (event.key === 'Escape') {
        if (handleEscape()) {
          event.preventDefault();
        }
        return;
      }

      if (event.key !== 'Tab') {
        return;
      }

      const focusableElements = getFocusableElements(currentDialog);
      if (focusableElements.length === 0) {
        event.preventDefault();
        currentDialog.focus();
        return;
      }

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];
      const activeElement = document.activeElement;
      if (event.shiftKey && (activeElement === firstElement || !currentDialog.contains(activeElement))) {
        event.preventDefault();
        lastElement.focus();
      } else if (
        !event.shiftKey &&
        (activeElement === lastElement || !currentDialog.contains(activeElement))
      ) {
        event.preventDefault();
        firstElement.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      const dialogIndex = openDialogStack.lastIndexOf(dialogToken);
      const wasTopDialog = dialogIndex >= 0 && dialogIndex === openDialogStack.length - 1;
      if (dialogIndex >= 0) {
        openDialogStack.splice(dialogIndex, 1);
      }
      unlockBodyScroll();
      if (wasTopDialog && previouslyFocused?.isConnected) {
        previouslyFocused.focus();
      }
    };
  }, [dialogRef, initialFocusRef, isOpen]);
}

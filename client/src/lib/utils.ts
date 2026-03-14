import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * 合并 className，支持 Tailwind CSS 类名去重
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

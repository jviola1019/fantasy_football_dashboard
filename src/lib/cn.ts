import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merge class names: clsx resolves conditionals, tailwind-merge dedupes
 * conflicting Tailwind utilities (last-wins). The standard shadcn/ui helper.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

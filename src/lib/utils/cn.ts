/**
 * Join class names, dropping any falsy values. A dependency-free `clsx`.
 *
 * @example cn("px-2", isActive && "bg-teal-600", undefined) // "px-2 bg-teal-600"
 */
export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

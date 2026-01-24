/**
 * Tailwind TypeScript helper
 *
 * This utility function helps with TypeScript autocomplete when using
 * Tailwind CSS classes as string literals. It's a no-op at runtime but
 * provides type information for IDE support.
 *
 * @param tailwindClasses - A string or template literal with Tailwind classes
 * @returns The same string unchanged
 *
 * @example
 * ```typescript
 * // With IDE plugins, you get autocomplete for Tailwind classes
 * const buttonClasses = tw`bg-blue-500 hover:bg-blue-700 text-white`;
 *
 * // Also works as a regular function
 * const classes = tw('flex items-center gap-2');
 * ```
 */
export const tw = <T extends string | TemplateStringsArray>(tailwindClasses: T): T => tailwindClasses;

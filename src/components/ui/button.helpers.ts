// Put any non-component exports here.
// Example scaffolding — adapt names to what you actually have.

export const BUTTON_SIZES = {
  sm: 'h-8 px-3 text-sm',
  md: 'h-10 px-4 text-base',
  lg: 'h-12 px-5 text-lg',
} as const;

export const BUTTON_VARIANTS = {
  primary: 'bg-emerald-700 text-white hover:bg-emerald-800',
  outline: 'border border-gray-300 hover:bg-gray-50',
  ghost: 'hover:bg-gray-100',
} as const;

export type ButtonSize = keyof typeof BUTTON_SIZES;
export type ButtonVariant = keyof typeof BUTTON_VARIANTS;

export function computeButtonClass(variant: ButtonVariant, size: ButtonSize): string {
  return `${BUTTON_VARIANTS[variant]} ${BUTTON_SIZES[size]} inline-flex items-center justify-center rounded-2xl transition`;
}

import type { ComponentChildren, JSX } from 'preact';

type Variant = 'primary' | 'secondary' | 'ghost';

// Intrinsic button attrs, not the generic HTMLAttributes: button-specific
// props like `disabled` only exist on the intrinsic element type.
interface ButtonProps extends Omit<JSX.IntrinsicElements['button'], 'size' | 'children'> {
  variant?: Variant;
  children: ComponentChildren;
}

/**
 * `primary` is --brand red and is reserved for primary ACTIONS only — never a
 * warning state. Warnings use --alert.
 */
export function Button({ variant = 'primary', children, class: className, ...rest }: ButtonProps) {
  return (
    <button type="button" class={`btn btn--${variant} ${className ?? ''}`.trim()} {...rest}>
      {children}
    </button>
  );
}

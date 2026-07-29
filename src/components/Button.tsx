import type { ComponentChildren, JSX } from 'preact';

type Variant = 'primary' | 'secondary' | 'ghost';

interface ButtonProps extends Omit<JSX.HTMLAttributes<HTMLButtonElement>, 'size'> {
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

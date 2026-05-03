import React from 'react';
import { cn } from '../../utils/cn'; // if you have a classnames util
import {
  type ButtonSize,
  type ButtonVariant,
  computeButtonClass,
} from './button.helpers';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  size?: ButtonSize;
  variant?: ButtonVariant;
}

export const Button: React.FC<ButtonProps> = ({
  size = 'md',
  variant = 'primary',
  className,
  ...rest
}) => {
  const base = computeButtonClass(variant, size);
  return <button className={cn(base, className)} {...rest} />;
};

export default Button;

// ⛔ Do not export non-component symbols from this file.
// (Keep all constants/functions in button.helpers.ts)

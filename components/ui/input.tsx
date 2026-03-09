// components/ui/input.tsx
//
// Shared form primitives with a consistent, always-legible style.
// Use these instead of bare <input> / <textarea> to avoid per-component fixes.

import { forwardRef } from "react";

// ─── Shared base classes ──────────────────────────────────────────────────────
// text-gray-900       → typed text is always dark and visible
// placeholder:text-gray-400 → placeholders are visible but clearly secondary
// bg-white            → explicit white background (prevents inherited backgrounds)
// border-gray-300     → subtle border that's still visible
// focus ring          → clear keyboard-focus indicator
// disabled            → muted appearance when non-interactive
const BASE =
  "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:opacity-60";

// ─── Input ────────────────────────────────────────────────────────────────────

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className = "", ...props }, ref) => (
    <input ref={ref} className={`${BASE} ${className}`} {...props} />
  )
);
Input.displayName = "Input";

// ─── Textarea ─────────────────────────────────────────────────────────────────

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className = "", ...props }, ref) => (
    <textarea
      ref={ref}
      className={`${BASE} resize-none ${className}`}
      {...props}
    />
  )
);
Textarea.displayName = "Textarea";

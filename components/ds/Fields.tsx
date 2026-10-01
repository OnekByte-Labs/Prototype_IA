import type { ComponentProps, ReactNode } from "react";
import { cx } from "@/lib/design/cx";

/**
 * Text-entry surfaces are *sunken*: an inset well in the canvas colour. The same
 * class strings are exported so raw <input>/<select> elements inside bespoke
 * layouts can share the look.
 */
const FIELD =
  "bg-canvas border border-line rounded-md shadow-inset-sm text-ui text-ink placeholder:text-ink-3 " +
  "transition-colors hover:border-line-strong focus:border-accent focus:outline-none " +
  "focus:ring-2 focus:ring-accent/25 disabled:opacity-50 disabled:cursor-not-allowed";

export const inputClass = cx(FIELD, "h-8 px-2.5");
export const selectClass = cx(FIELD, "ds-select h-8 pl-2.5 cursor-pointer");
export const textareaClass = cx(FIELD, "px-2.5 py-2 resize-none");

export function Input({ className, ...rest }: ComponentProps<"input">) {
  return <input className={cx(inputClass, className)} {...rest} />;
}

export function Select({ className, children, ...rest }: ComponentProps<"select">) {
  return (
    <select className={cx(selectClass, className)} {...rest}>
      {children}
    </select>
  );
}

export function Textarea({ className, ...rest }: ComponentProps<"textarea">) {
  return <textarea className={cx(textareaClass, className)} {...rest} />;
}

export function Checkbox({
  label,
  className,
  ...rest
}: Omit<ComponentProps<"input">, "type"> & { label?: ReactNode }) {
  const box = <input type="checkbox" className={cx("ds-check", className)} {...rest} />;
  if (!label) return box;
  return (
    <label className="inline-flex items-center gap-2 text-ui text-ink cursor-pointer">
      {box}
      {label}
    </label>
  );
}

/** Label above a control, with optional hint and error. */
export function Field({
  label,
  hint,
  error,
  children,
  className,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cx("flex flex-col gap-1.5 min-w-0", className)}>
      <span className="text-caption font-medium text-ink-2">{label}</span>
      {children}
      {error ? (
        <span className="text-caption text-crit-ink">{error}</span>
      ) : (
        hint && <span className="text-caption text-ink-3">{hint}</span>
      )}
    </label>
  );
}

/** On/off switch. Track is an inset well; the knob is raised. */
export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        "relative w-9 h-5 rounded-full shadow-inset-sm transition-colors shrink-0 disabled:opacity-45",
        checked ? "bg-accent" : "bg-sunken",
      )}
    >
      <span
        className={cx(
          "absolute top-0.5 w-4 h-4 rounded-full bg-raised shadow-key-sm transition-[left]",
          checked ? "left-[18px]" : "left-0.5",
        )}
      />
    </button>
  );
}

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cx } from "@/lib/design/cx";
import { Tooltip } from "./Tooltip";

type Variant = "default" | "primary" | "danger" | "ghost";
type Size = "sm" | "md" | "lg";

const BASE =
  "inline-flex items-center justify-center gap-1.5 rounded-md font-medium whitespace-nowrap select-none " +
  "transition-[box-shadow,background-color,color] duration-100 disabled:opacity-45 disabled:shadow-none";

const VARIANT: Record<Variant, string> = {
  default:
    "bg-raised text-ink border border-line shadow-key-sm hover:bg-hover active:shadow-inset-sm active:bg-canvas",
  primary:
    "bg-accent text-ink border border-accent-soft shadow-key-sm hover:bg-accent-soft active:shadow-inset-sm active:bg-accent",
  danger:
    "bg-raised text-crit-ink border border-crit/35 shadow-key-sm hover:bg-crit-wash active:shadow-inset-sm active:bg-crit-wash",
  ghost: "bg-transparent text-ink-2 border border-transparent hover:bg-hover hover:text-ink active:shadow-inset-sm",
};

const SIZE: Record<Size, string> = {
  sm: "h-7 px-2.5 text-ui",
  md: "h-8 px-3 text-ui",
  lg: "h-9 px-4 text-body",
};

/** Class string for anything that must look like a Button but is not a <button> (links, labels). */
export function buttonClass(variant: Variant = "default", size: Size = "md", extra = "") {
  return cx(BASE, VARIANT[variant], SIZE[size], extra);
}

type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type"> & {
  children: ReactNode;
  variant?: Variant;
  size?: Size;
  type?: "button" | "submit";
  /** Toggle buttons: draws the pressed (inset) state with an accent label. */
  pressed?: boolean;
};

export function Button({
  children,
  variant = "default",
  size = "md",
  type = "button",
  pressed,
  className,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      aria-pressed={pressed}
      className={cx(
        buttonClass(variant, size),
        pressed && "bg-canvas! shadow-inset-sm! text-accent-ink!",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type" | "aria-label"> & {
  /** Icon-only controls always carry a text label for assistive tech and the tooltip. */
  label: string;
  children: ReactNode;
  size?: "sm" | "md";
  pressed?: boolean;
  variant?: "default" | "ghost";
};

export function IconButton({ label, children, size = "md", pressed, variant = "ghost", className, ...rest }: IconButtonProps) {
  return (
    <Tooltip text={label} side="bottom">
      <button
        type="button"
        aria-label={label}
        aria-pressed={pressed}
        className={cx(
          "inline-flex items-center justify-center rounded-md transition-[box-shadow,background-color,color] duration-100 disabled:opacity-45",
          size === "sm" ? "w-7 h-7" : "w-8 h-8",
          variant === "default"
            ? "bg-raised border border-line shadow-key-sm hover:bg-hover active:shadow-inset-sm text-ink-2 hover:text-ink"
            : "text-ink-2 hover:text-ink hover:bg-hover active:shadow-inset-sm",
          pressed && "bg-canvas! shadow-inset-sm! text-accent-ink!",
          className,
        )}
        {...rest}
      >
        {children}
      </button>
    </Tooltip>
  );
}

type IconProps = {
  name: string;
  size?: number;
  className?: string;
  /** Solid glyph (FILL 1), used for active states. */
  filled?: boolean;
};

// Size is set inline because the Google Fonts stylesheet defines an unlayered
// `.material-symbols-outlined { font-size: 24px }` that would beat Tailwind utilities.
export function Icon({ name, size = 16, className = "", filled = false }: IconProps) {
  return (
    <span
      aria-hidden="true"
      className={`material-symbols-outlined select-none overflow-hidden inline-flex items-center justify-center ${className}`}
      style={{
        fontSize: size,
        width: size,
        height: size,
        lineHeight: 1,
        fontVariationSettings: `'FILL' ${filled ? 1 : 0}, 'wght' 400, 'GRAD' 0, 'opsz' 20`,
      }}
    >
      {name}
    </span>
  );
}

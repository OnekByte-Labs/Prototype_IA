type IconProps = {
  name: string;
  size?: number;
  className?: string;
  /** Solid glyph (FILL 1), used for active states. */
  filled?: boolean;
};

// Material Symbols Outlined at a light weight so icons match 13px text.
// Size is set inline because the Google Fonts stylesheet defines an unlayered
// `.material-symbols-outlined { font-size: 24px }` that would beat Tailwind utilities.
// Every name used here must also be listed in MATERIAL_SYMBOLS_URL (app/layout.tsx).
export function Icon({ name, size = 16, className = "", filled = false }: IconProps) {
  return (
    <span
      aria-hidden="true"
      className={`material-symbols-outlined shrink-0 ${className}`}
      style={{
        fontSize: size,
        lineHeight: 1,
        fontVariationSettings: `'FILL' ${filled ? 1 : 0}, 'wght' 350, 'GRAD' 0, 'opsz' 20`,
      }}
    >
      {name}
    </span>
  );
}

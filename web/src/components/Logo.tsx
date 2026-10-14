/**
 * The BreachScope mark: a crosshair on a dark tile. Same drawing as
 * public/favicon.svg, coloured from the theme tokens.
 */
export function Logo({ size = 20 }: { size?: number }) {
  return (
    <svg
      className="logo"
      width={size}
      height={size}
      viewBox="0 0 32 32"
      aria-hidden="true"
      focusable="false"
    >
      <rect width="32" height="32" rx="6" fill="var(--bg-panel)" />
      <circle cx="16" cy="16" r="9" fill="none" stroke="var(--accent)" strokeWidth="2" />
      <path d="M16 3v7m0 12v7M3 16h7m12 0h7" stroke="var(--accent)" strokeWidth="2" />
    </svg>
  );
}

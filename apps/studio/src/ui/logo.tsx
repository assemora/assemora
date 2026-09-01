/**
 * The mark: two legs and a crossbar — an A, built rather than drawn.
 *
 * Three positioned spans, exactly as `Assemora Logo.dc.html` constructs it. Percentages
 * rather than a path, so one component serves the 22px in the chrome bar and the 44px on
 * the sign-in panel without a second asset and without a rounding error between them.
 *
 * The legs take `currentColor`, so the mark reads on the dark chrome bar and on a white
 * panel from the same call. The crossbar is always the accent: it is the one place in
 * Studio's own chrome where the accent appears at rest.
 */
export const Logo = ({ size = 22, className }: { size?: number; className?: string }) => {
  const radius = Math.max(1, Math.round(size / 16))

  return (
    <span
      aria-hidden
      className={className}
      style={{ position: 'relative', display: 'block', width: size, height: size, flexShrink: 0 }}
    >
      <span
        style={{
          position: 'absolute',
          left: '14%',
          bottom: '8%',
          width: '16%',
          height: '80%',
          borderRadius: radius,
          background: 'currentColor',
          transformOrigin: 'bottom center',
          transform: 'rotate(14deg)',
        }}
      />
      <span
        style={{
          position: 'absolute',
          right: '14%',
          bottom: '8%',
          width: '16%',
          height: '80%',
          borderRadius: radius,
          background: 'currentColor',
          transformOrigin: 'bottom center',
          transform: 'rotate(-14deg)',
        }}
      />
      <span
        style={{
          position: 'absolute',
          left: '26%',
          bottom: '25%',
          width: '48%',
          height: '15%',
          borderRadius: radius,
          background: 'var(--color-accent)',
        }}
      />
    </span>
  )
}

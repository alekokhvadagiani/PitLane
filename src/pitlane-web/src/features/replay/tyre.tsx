import { useId } from 'react'

/**
 * Side view of a slick: black sidewall, compound stripe, 18-inch wheel cover
 * and centre nut. `detailed` adds the compound name along the sidewall, for
 * large sizes only. The stripe uses `currentColor` so CSS can recolour it.
 */
export function TyreGraphic({
  detailed = false,
  label,
  className,
}: {
  detailed?: boolean
  label?: string
  className?: string
}) {
  const id = useId().replace(/:/g, '')
  return (
    <svg
      className={className ? `tyre-graphic ${className}` : 'tyre-graphic'}
      viewBox="0 0 100 100"
      aria-hidden="true"
    >
      <defs>
        <radialGradient id={`${id}-rubber`} cx="38%" cy="32%" r="75%">
          <stop offset="0" stopColor="#3a3d42" />
          <stop offset="0.55" stopColor="#1a1c1f" />
          <stop offset="1" stopColor="#0a0b0c" />
        </radialGradient>
        <radialGradient id={`${id}-cover`} cx="40%" cy="35%" r="70%">
          <stop offset="0" stopColor="#4a4f57" />
          <stop offset="1" stopColor="#16181b" />
        </radialGradient>
        <path id={`${id}-arc`} d="M 50 50 m -36 0 a 36 36 0 1 1 72 0" />
        <path id={`${id}-arc-low`} d="M 50 50 m 36 0 a 36 36 0 1 1 -72 0" />
      </defs>
      {/* tread face seen at the edge */}
      <circle cx="50" cy="50" r="49" fill="#070708" />
      <circle cx="50" cy="50" r="47" fill={`url(#${id}-rubber)`} />
      {/* compound stripe, split like the real sidewall marking */}
      <circle
        className="tyre-stripe"
        cx="50"
        cy="50"
        r="39.5"
        fill="none"
        stroke="currentColor"
        strokeWidth={detailed ? 4 : 6}
        pathLength="100"
        strokeDasharray={detailed ? '30 20' : '40 10'}
        transform="rotate(-62 50 50)"
      />
      {detailed && label ? (
        <g className="tyre-lettering" fill="#d9dce0">
          <text fontSize="6.4" letterSpacing="1.4">
            <textPath href={`#${id}-arc`} startOffset="50%" textAnchor="middle">
              {label}
            </textPath>
          </text>
          <text fontSize="6.4" letterSpacing="1.4">
            <textPath
              href={`#${id}-arc-low`}
              startOffset="50%"
              textAnchor="middle"
            >
              {label}
            </textPath>
          </text>
        </g>
      ) : null}
      {/* bead and rim lip */}
      <circle cx="50" cy="50" r="31" fill="#0c0d0f" />
      <circle
        cx="50"
        cy="50"
        r="29.5"
        fill={`url(#${id}-cover)`}
        stroke="#7b818a"
        strokeWidth="1.2"
      />
      {/* wheel cover vanes */}
      {Array.from({ length: 10 }, (_, index) => (
        <path
          key={index}
          d="M50 24 L52 30 L48 30 Z"
          fill="#5b616a"
          opacity="0.55"
          transform={`rotate(${index * 36} 50 50)`}
        />
      ))}
      <circle cx="50" cy="50" r="9" fill="#101215" stroke="#3b3f45" />
      {/* centre lock nut */}
      <polygon
        className="tyre-nut"
        points="50,43.5 55.6,46.75 55.6,53.25 50,56.5 44.4,53.25 44.4,46.75"
        fill="currentColor"
      />
      <circle cx="50" cy="50" r="2" fill="#0b0c0e" />
      {/* specular highlight on the shoulder */}
      <path
        d="M 18 30 A 38 38 0 0 1 46 12"
        fill="none"
        stroke="#ffffff"
        strokeOpacity="0.14"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  )
}

/** Loading indicator: a rolling tyre. Static when reduced motion is set. */
export function TyreLoader({
  label,
  compact = false,
}: {
  label: string
  compact?: boolean
}) {
  return (
    <div className={`tyre-loader ${compact ? 'compact' : ''}`} role="status">
      <span className="tyre-loader-wheel" style={{ color: '#e8002d' }}>
        <TyreGraphic detailed={!compact} label="PITLANE" />
      </span>
      <span>{label}…</span>
    </div>
  )
}

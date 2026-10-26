const outline =
  'M 126 281 L 206 225 Q 212 221 218 226 L 239 243 Q 245 248 252 242 L 302 194 Q 309 187 316 193 L 340 212 Q 347 218 355 210 L 393 169 Q 400 162 408 168 L 432 185 Q 439 190 447 182 L 504 121 Q 510 114 519 115 L 599 126 Q 617 128 619 145 L 628 196 Q 630 209 617 213 L 559 231 Q 549 234 548 246 L 544 267 Q 543 279 531 283 L 479 301 Q 467 305 459 295 L 432 263 Q 425 255 416 261 L 363 299 Q 353 306 343 302 L 303 285 Q 295 281 288 288 L 265 312 Q 258 319 250 317 L 213 306 Q 205 304 198 309 L 170 330 Q 161 337 151 328 L 127 306 Q 113 293 126 281 Z'

export function Circuit() {
  return (
    <figure className="circuit-figure">
      <svg
        viewBox="0 0 760 440"
        role="img"
        aria-labelledby="circuit-title circuit-description"
      >
        <title id="circuit-title">Illustrative circuit outline</title>
        <desc id="circuit-description">
          A schematic circuit showing the future replay workspace. This is not a
          real circuit or recorded car position data.
        </desc>
        <defs>
          <pattern
            id="circuit-grid"
            width="32"
            height="32"
            patternUnits="userSpaceOnUse"
          >
            <path
              d="M 32 0 L 0 0 0 32"
              fill="none"
              stroke="currentColor"
              strokeWidth=".5"
            />
          </pattern>
        </defs>
        <rect
          width="760"
          height="440"
          fill="url(#circuit-grid)"
          className="map-grid"
        />
        <g fill="none" strokeLinejoin="round" strokeLinecap="round">
          <path d={outline} stroke="#080a0d" strokeWidth="27" />
          <path d={outline} stroke="#292f37" strokeWidth="15" />
          <path d={outline} stroke="#69717d" strokeWidth="2" />
          <path d="M 510 120 L 590 131" stroke="#f04438" strokeWidth="4" />
          <path
            d="M 231 211 L 272 171 M 283 160 L 300 144"
            stroke="#343c46"
            strokeWidth="1"
          />
          <path
            d="M 540 323 L 575 353 L 640 353"
            stroke="#343c46"
            strokeWidth="1"
          />
        </g>
        <text x="243" y="148" className="map-annotation">
          Circuit workspace
        </text>
        <text x="579" y="374" className="map-annotation">
          Awaiting session
        </text>
      </svg>
      <figcaption>
        <span className="legend-line" /> Illustrative layout{' '}
        <span className="caption-divider" /> No position data
      </figcaption>
    </figure>
  )
}

import outlines from './circuit-outlines.json'

// Flags from flag-icons (MIT, see src/assets/flags/LICENSE). Only the
// countries on the 2023+ calendar are bundled; each loads when displayed.
const flagUrls = import.meta.glob<string>('../../assets/flags/*.svg', {
  eager: true,
  import: 'default',
  query: '?url',
})

type Country = { code: string; colours: [string, string] }

/** ISO code and the two main colours of each host country's flag. */
const countries: Record<string, Country> = {
  Australia: { code: 'au', colours: ['#012169', '#e4002b'] },
  Austria: { code: 'at', colours: ['#c8102e', '#f1efe8'] },
  Azerbaijan: { code: 'az', colours: ['#0092bc', '#00b140'] },
  Bahrain: { code: 'bh', colours: ['#ce1126', '#f1efe8'] },
  Belgium: { code: 'be', colours: ['#fdda24', '#ef3340'] },
  Brazil: { code: 'br', colours: ['#009c3b', '#ffdf00'] },
  Canada: { code: 'ca', colours: ['#d80621', '#f1efe8'] },
  China: { code: 'cn', colours: ['#ee1c25', '#ffde00'] },
  Hungary: { code: 'hu', colours: ['#ce2939', '#477050'] },
  Italy: { code: 'it', colours: ['#009246', '#ce2b37'] },
  Japan: { code: 'jp', colours: ['#bc002d', '#f1efe8'] },
  Mexico: { code: 'mx', colours: ['#006847', '#ce1126'] },
  Monaco: { code: 'mc', colours: ['#ce1126', '#f1efe8'] },
  Netherlands: { code: 'nl', colours: ['#ae1c28', '#21468b'] },
  Qatar: { code: 'qa', colours: ['#8a1538', '#f1efe8'] },
  'Saudi Arabia': { code: 'sa', colours: ['#006c35', '#f1efe8'] },
  Singapore: { code: 'sg', colours: ['#ef3340', '#f1efe8'] },
  Spain: { code: 'es', colours: ['#aa151b', '#f1bf00'] },
  'United Arab Emirates': { code: 'ae', colours: ['#00732f', '#ff0000'] },
  'United Kingdom': { code: 'gb', colours: ['#012169', '#c8102e'] },
  'United States': { code: 'us', colours: ['#3c3b6e', '#b22234'] },
}

export function countryLook(countryName: string) {
  const country = countries[countryName]
  return {
    flag: country
      ? flagUrls[`../../assets/flags/${country.code}.svg`]
      : undefined,
    colours: country?.colours ?? (['#3a3f46', '#3a3f46'] as const),
  }
}

/**
 * One recorded lap of the circuit as an SVG path in a 100×100 box, traced
 * from OpenF1 car positions by a one-off script. Missing when no clean lap
 * was recorded.
 */
export function circuitOutline(circuitShortName: string): string | undefined {
  return (outlines as Record<string, string>)[circuitShortName]
}

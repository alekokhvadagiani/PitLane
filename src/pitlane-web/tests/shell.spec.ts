import { test, expect } from '@playwright/test'

const currentYear = new Date().getUTCFullYear()
const capabilities = {
  stage: 'foundation',
  modes: ['live', 'replay', 'telemetry', 'radio'].map((id) => ({
    id,
    status: 'notIntegrated',
    reason: 'Provider coverage varies by mode.',
  })),
}

test('race navigation stays compact and pages explain data availability', async ({
  page,
}, testInfo) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('**/api/capabilities', (route) =>
    route.fulfill({ json: capabilities }),
  )
  await page.goto('/#overview')

  const navigation = page.getByRole('navigation', { name: 'Main navigation' })
  await expect(
    page.getByRole('heading', { name: /Every lap has/ }),
  ).toBeVisible()
  await page.screenshot({
    path: testInfo.outputPath('overview.png'),
    fullPage: true,
  })
  await expect(navigation.getByRole('link')).toHaveCount(5)
  for (const [label, hash, heading] of [
    ['Live', 'live', 'No live feed connected'],
    ['Replay', 'replay', 'Choose a historical session'],
    ['Telemetry', 'telemetry', 'Compare a recorded lap'],
    ['Team Radio', 'radio', 'No radio clips loaded'],
  ]) {
    await navigation.getByRole('link', { name: label }).click()
    await expect(page).toHaveURL(new RegExp(`#${hash}$`))
    await expect(page.getByRole('heading', { name: heading })).toBeVisible()
    await expect(navigation.getByRole('link', { name: label })).toHaveAttribute(
      'aria-current',
      'page',
    )
  }
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true)
  expect(errors).toEqual([])
})

test('race browser selects a session and synchronizes real-data views', async ({
  page,
}, testInfo) => {
  const start = new Date(Date.now() - 2 * 60 * 60_000).toISOString()
  const end = new Date(Date.parse(start) + 2 * 60 * 60_000).toISOString()
  const sample = new Date(start).toISOString()
  const catalog = {
    source: 'OpenF1',
    retrievedAtUtc: new Date().toISOString(),
    items: [],
  }
  await page.route('**/api/capabilities', (route) =>
    route.fulfill({ json: capabilities }),
  )
  await page.route('**/api/meetings**', (route) => {
    const url = new URL(route.request().url())
    if (url.pathname.endsWith('/sessions')) {
      return route.fulfill({
        json: {
          ...catalog,
          items: [
            {
              sessionKey: 11396,
              meetingKey: 1297,
              sessionName: 'Race',
              sessionType: 'Race',
              dateStart: start,
              dateEnd: end,
            },
          ],
        },
      })
    }
    return route.fulfill({
      json: {
        ...catalog,
        items: [
          {
            meetingKey: 1297,
            meetingName: 'PitLane Test Grand Prix',
            location: 'Austin',
            countryName: 'United States',
            circuitShortName: 'Circuit of the Americas',
            year: currentYear,
            dateStart: start,
            dateEnd: end,
            isCancelled: false,
          },
        ],
      },
    })
  })
  await page.route('**/api/sessions/11396/**', (route) => {
    const url = new URL(route.request().url())
    const items = url.pathname.endsWith('/drivers')
      ? [
          {
            driverNumber: 44,
            fullName: 'Test Driver',
            nameAcronym: 'TST',
            teamName: 'Test Team',
            teamColour: 'ED1131',
          },
          {
            driverNumber: 16,
            fullName: 'Second Driver',
            nameAcronym: 'SEC',
            teamName: 'Blue Test Team',
            teamColour: '0090FF',
          },
        ]
      : url.pathname.endsWith('/classification')
        ? [
            { date: sample, driverNumber: 44, position: 1 },
            { date: sample, driverNumber: 16, position: 2 },
          ]
        : url.pathname.endsWith('/car-data')
          ? [
              {
                date: sample,
                driverNumber: Number(
                  url.searchParams.get('driverNumber') ?? 44,
                ),
                speed:
                  Number(url.searchParams.get('driverNumber') ?? 44) === 44
                    ? 250
                    : 214,
                throttle: 87,
                brake: 0,
                rpm: 9328,
                gear: 4,
                drs: 10,
              },
            ]
          : url.pathname.endsWith('/laps')
            ? [
                {
                  lapNumber: 1,
                  dateStart: sample,
                  lapDuration: 90.25,
                  sector1Duration: 30,
                  sector2Duration: 30,
                  sector3Duration: 30.25,
                  isPitOutLap: false,
                },
              ]
            : url.pathname.endsWith('/weather')
              ? []
              : [
                  { date: sample, driverNumber: 44, x: 100, y: 100, z: 0 },
                  {
                    date: new Date(Date.parse(sample) + 250).toISOString(),
                    driverNumber: 44,
                    x: 110,
                    y: 120,
                    z: 0,
                  },
                  {
                    date: new Date(Date.parse(sample) + 500).toISOString(),
                    driverNumber: 44,
                    x: 125,
                    y: 130,
                    z: 0,
                  },
                  { date: sample, driverNumber: 16, x: 145, y: 80, z: 0 },
                  {
                    date: new Date(Date.parse(sample) + 250).toISOString(),
                    driverNumber: 16,
                    x: 165,
                    y: 105,
                    z: 0,
                  },
                  {
                    date: new Date(Date.parse(sample) + 500).toISOString(),
                    driverNumber: 16,
                    x: 180,
                    y: 100,
                    z: 0,
                  },
                ]
    return route.fulfill({ json: { ...catalog, items } })
  })

  await page.goto('/#replay')
  await page.getByRole('button', { name: 'Browse historical sessions' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(
    dialog.getByRole('heading', { name: 'Find a race weekend' }),
  ).toBeVisible()
  await page.screenshot({
    path: testInfo.outputPath('session-browser.png'),
    fullPage: true,
  })
  await dialog.getByRole('button', { name: /PitLane Test Grand Prix/ }).click()
  await dialog.locator('.session-option').filter({ hasText: 'Race' }).click()
  await expect(dialog).not.toBeVisible()
  await expect(page).toHaveURL(
    new RegExp(`#replay\\?year=${currentYear}&meeting=1297&session=11396`),
  )
  await expect(
    page.getByRole('heading', { name: 'PitLane Test Grand Prix' }),
  ).toBeVisible()
  await expect(
    page.getByRole('group', {
      name: 'Circuit map with interactive recorded car positions',
    }),
  ).toBeVisible()
  await expect(page.getByText('250', { exact: true })).toBeVisible()
  await expect(
    page
      .getByRole('img', {
        name: 'Recorded speed 250 kilometers per hour, throttle 87 percent',
      })
      .getByText('9,328', { exact: true }),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: 'Play replay' })).toBeEnabled()
  await page
    .getByRole('button', { name: 'Select Second Driver on circuit' })
    .click()
  await expect(page.getByRole('button', { name: /SEC/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(
    page.getByRole('complementary', { name: 'Selected car telemetry' }),
  ).toContainText('SEC')
  await page.screenshot({
    path: testInfo.outputPath('race-replay.png'),
    fullPage: true,
  })
})

test('upcoming sessions cannot be opened as historical replays', async ({
  page,
}) => {
  const futureStart = new Date(Date.now() + 24 * 60 * 60_000).toISOString()
  await page.route('**/api/capabilities', (route) =>
    route.fulfill({ json: capabilities }),
  )
  await page.route('**/api/meetings**', (route) => {
    const url = new URL(route.request().url())
    const items = url.pathname.endsWith('/sessions')
      ? [
          {
            sessionKey: 11999,
            meetingKey: 1299,
            sessionName: 'Race',
            sessionType: 'Race',
            dateStart: futureStart,
            dateEnd: new Date(
              Date.parse(futureStart) + 2 * 60 * 60_000,
            ).toISOString(),
          },
        ]
      : [
          {
            meetingKey: 1299,
            meetingName: 'Future Grand Prix',
            location: 'Circuit',
            countryName: 'Country',
            circuitShortName: 'Circuit',
            year: currentYear,
            dateStart: futureStart,
            dateEnd: futureStart,
            isCancelled: false,
          },
        ]
    return route.fulfill({
      json: {
        source: 'OpenF1',
        retrievedAtUtc: new Date().toISOString(),
        items,
      },
    })
  })
  await page.goto('/#replay')
  await page.getByRole('button', { name: 'Browse historical sessions' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: /Future Grand Prix/ }).click()
  await expect(dialog.locator('.session-option')).toBeDisabled()
  await expect(dialog.getByText('Upcoming', { exact: true })).toBeVisible()
})

test('API failure stays visible and retry recovers', async ({ page }) => {
  let available = false
  await page.route('**/api/capabilities', (route) =>
    available
      ? route.fulfill({ json: capabilities })
      : route.fulfill({ status: 503, json: { title: 'Unavailable' } }),
  )
  await page.goto('/#overview')
  await expect(
    page.getByText('API unavailable', { exact: false }),
  ).toBeVisible()
  available = true
  await page.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(page.getByText('API connected', { exact: true })).toBeVisible()
})

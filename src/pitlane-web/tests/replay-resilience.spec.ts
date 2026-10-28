import { expect, test, type Page } from '@playwright/test'

const start = '2025-10-19T19:00:00.000Z'
const end = '2025-10-19T21:00:00.000Z'
const sessionKey = 11996
const selectionUrl = '/#replay?year=2025&meeting=1297&session=11996'
const catalog = { source: 'OpenF1', retrievedAtUtc: start, items: [] }

async function installReplayFixture(
  page: Page,
  options?: { failPositions?: () => boolean; counts?: Map<string, number> },
) {
  await page.route('**/api/capabilities', (route) =>
    route.fulfill({ json: { stage: 'foundation', modes: [] } }),
  )
  await page.route('**/api/meetings**', (route) => {
    const url = new URL(route.request().url())
    if (url.pathname.endsWith('/sessions'))
      return route.fulfill({
        json: {
          ...catalog,
          items: [
            {
              sessionKey,
              meetingKey: 1297,
              sessionName: 'Race',
              sessionType: 'Race',
              dateStart: start,
              dateEnd: end,
            },
          ],
        },
      })
    return route.fulfill({
      json: {
        ...catalog,
        items: [
          {
            meetingKey: 1297,
            meetingName: 'Regression Grand Prix',
            location: 'Austin',
            countryName: 'United States',
            circuitShortName: 'Circuit of the Americas',
            year: 2025,
            dateStart: start,
            dateEnd: end,
            isCancelled: false,
          },
        ],
      },
    })
  })
  await page.route(`**/api/sessions/${sessionKey}/**`, (route) => {
    const url = new URL(route.request().url())
    const kind = url.pathname.split('/').at(-1) ?? 'unknown'
    options?.counts?.set(kind, (options.counts.get(kind) ?? 0) + 1)
    if (kind === 'race-positions' && options?.failPositions?.())
      return route.fulfill({
        status: 503,
        json: { title: 'Temporary provider failure' },
      })
    const items =
      kind === 'drivers'
        ? [
            {
              driverNumber: 44,
              fullName: 'Test Driver',
              nameAcronym: 'TST',
              teamName: 'Test Team',
              teamColour: 'ED1131',
            },
          ]
        : kind === 'race-positions'
          ? options?.failPositions
            ? []
            : [
                { date: start, driverNumber: 44, x: 10, y: 10, z: 0 },
                {
                  date: new Date(Date.parse(start) + 250).toISOString(),
                  driverNumber: 44,
                  x: 15,
                  y: 20,
                  z: 0,
                },
              ]
          : kind === 'car-data'
            ? [
                {
                  date: start,
                  driverNumber: 44,
                  speed: 100,
                  throttle: 20,
                  brake: 0,
                  rpm: 5000,
                  gear: 3,
                  drs: 8,
                },
                {
                  date: new Date(Date.parse(start) + 1000).toISOString(),
                  driverNumber: 44,
                  speed: 200,
                  throttle: 80,
                  brake: 1,
                  rpm: 9000,
                  gear: 4,
                  drs: 10,
                },
              ]
            : []
    return route.fulfill({ json: { ...catalog, items } })
  })
}

test('position errors stay distinct from empty data and can be retried', async ({
  page,
}) => {
  let fail = true
  await installReplayFixture(page, { failPositions: () => fail })
  await page.goto(selectionUrl)
  await expect(page.getByText('Position feed unavailable')).toBeVisible()
  await expect(page.getByText('No recorded position samples')).toHaveCount(0)
  fail = false
  await page.getByRole('button', { name: 'Retry positions' }).click()
  await expect(page.getByText('No recorded position samples')).toBeVisible()
  await expect(page.getByText('Position feed unavailable')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Play replay' })).toBeDisabled()
  const lapJump = page.getByRole('combobox', { name: 'Jump to lap' })
  await expect(lapJump).toBeDisabled()
  await expect(lapJump.locator('option')).toHaveText(['NO LAP DATA'])
})

test('historical replay data is reused after navigating away and back', async ({
  page,
}) => {
  const counts = new Map<string, number>()
  await installReplayFixture(page, { counts })
  await page.goto(selectionUrl)
  // The loading strip is removed once every stage is ready.
  await expect(page.locator('.race-track-map')).toBeVisible()
  await expect(page.locator('.replay-progress-strip')).toHaveCount(0)
  await expect(
    page.getByRole('button', { name: 'Select Test Driver on circuit' }),
  ).toBeVisible()
  const requestsBefore = new Map(counts)
  await page.evaluate(() => {
    location.hash = '#replay'
  })
  await expect(
    page.getByRole('heading', { name: 'Pick a race to replay.' }),
  ).toBeVisible()
  await page.evaluate((hash) => {
    location.hash = hash
  }, selectionUrl.slice(1))
  await expect(page.locator('.race-track-map')).toBeVisible()
  await expect(page.locator('.replay-progress-strip')).toHaveCount(0)
  await expect(
    page.getByRole('button', { name: 'Select Test Driver on circuit' }),
  ).toBeVisible()
  expect([...counts.entries()]).toEqual([...requestsBefore.entries()])
})

test('switching away cancels unfinished position-window requests', async ({
  page,
}) => {
  await installReplayFixture(page)
  let signalStarted!: () => void
  const started = new Promise<void>((resolve) => {
    signalStarted = resolve
  })
  let signalAborted!: () => void
  const aborted = new Promise<void>((resolve) => {
    signalAborted = resolve
  })
  let abortedCount = 0
  page.on('requestfailed', (request) => {
    if (request.url().includes(`/api/sessions/${sessionKey}/race-positions`)) {
      abortedCount++
      signalAborted()
    }
  })
  await page.route(
    `**/api/sessions/${sessionKey}/race-positions*`,
    async () => {
      signalStarted()
      await aborted
    },
  )
  await page.goto(selectionUrl)
  await started
  await page.evaluate(() => {
    location.hash = '#replay'
  })
  await expect(
    page.getByRole('heading', { name: 'Pick a race to replay.' }),
  ).toBeVisible()
  await expect.poll(() => abortedCount, { timeout: 5_000 }).toBeGreaterThan(0)
})

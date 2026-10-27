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

test('race browser synchronizes cockpit telemetry and the unified replay timeline', async ({
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
  await page.route('**/api/sessions/11396/**', async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname.endsWith('/race-positions'))
      await new Promise<void>((resolve) => setTimeout(resolve, 650))
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
      : url.pathname.endsWith('/all-laps')
        ? [
            {
              driverNumber: 44,
              lapNumber: 1,
              dateStart: sample,
              lapDuration: 90.25,
              sector1Duration: 30,
              sector2Duration: 30,
              sector3Duration: 30.25,
              isPitOutLap: false,
            },
            {
              driverNumber: 44,
              lapNumber: 4,
              dateStart: new Date(Date.parse(sample) + 120_000).toISOString(),
              lapDuration: 91.5,
              sector1Duration: 30.5,
              sector2Duration: 30.5,
              sector3Duration: 30.5,
              isPitOutLap: false,
            },
            {
              driverNumber: 16,
              lapNumber: 1,
              dateStart: sample,
              lapDuration: 91.25,
              sector1Duration: 30,
              sector2Duration: 30,
              sector3Duration: 31.25,
              isPitOutLap: false,
            },
          ]
        : url.pathname.endsWith('/stints')
          ? [
              {
                driverNumber: 44,
                stintNumber: 1,
                compound: 'SOFT',
                lapStart: 1,
                lapEnd: 20,
                tyreAgeAtStart: 0,
              },
              {
                driverNumber: 16,
                stintNumber: 1,
                compound: 'HARD',
                lapStart: 1,
                lapEnd: 20,
                tyreAgeAtStart: 3,
              },
            ]
          : url.pathname.endsWith('/pit-stops')
            ? [
                {
                  date: new Date(Date.parse(sample) + 310_000).toISOString(),
                  driverNumber: 44,
                  lapNumber: 1,
                  laneDuration: 10,
                },
              ]
            : url.pathname.endsWith('/results')
              ? [
                  {
                    driverNumber: 44,
                    dnf: false,
                    dns: false,
                    dsq: false,
                    position: 1,
                    numberOfLaps: 20,
                  },
                  {
                    driverNumber: 16,
                    dnf: true,
                    dns: false,
                    dsq: false,
                    position: null,
                    numberOfLaps: 12,
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
                          Number(url.searchParams.get('driverNumber') ?? 44) ===
                          44
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
                          {
                            date: sample,
                            driverNumber: 44,
                            x: 100,
                            y: 100,
                            z: 0,
                          },
                          {
                            date: new Date(
                              Date.parse(sample) + 250,
                            ).toISOString(),
                            driverNumber: 44,
                            x: 110,
                            y: 120,
                            z: 0,
                          },
                          {
                            date: new Date(
                              Date.parse(sample) + 500,
                            ).toISOString(),
                            driverNumber: 44,
                            x: 125,
                            y: 130,
                            z: 0,
                          },
                          {
                            date: new Date(
                              Date.parse(sample) + 300_000,
                            ).toISOString(),
                            driverNumber: 44,
                            x: 200,
                            y: 160,
                            z: 0,
                          },
                          {
                            date: new Date(
                              Date.parse(sample) + 310_000,
                            ).toISOString(),
                            driverNumber: 44,
                            x: 230,
                            y: 180,
                            z: 0,
                          },
                          {
                            date: new Date(
                              Date.parse(sample) + 311_000,
                            ).toISOString(),
                            driverNumber: 44,
                            x: 240,
                            y: 185,
                            z: 0,
                          },
                          {
                            date: sample,
                            driverNumber: 16,
                            x: 145,
                            y: 80,
                            z: 0,
                          },
                          {
                            date: new Date(
                              Date.parse(sample) + 250,
                            ).toISOString(),
                            driverNumber: 16,
                            x: 165,
                            y: 105,
                            z: 0,
                          },
                          {
                            date: new Date(
                              Date.parse(sample) + 500,
                            ).toISOString(),
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
  await expect(page.getByText('Preparing the circuit')).toBeVisible()
  await expect(page.getByText('No recorded position samples')).toHaveCount(0)
  await expect(
    page.getByRole('group', {
      name: 'Circuit map with interactive recorded car positions',
    }),
  ).toBeVisible()
  await expect(page.getByText('250', { exact: true })).toBeVisible()
  await expect
    .poll(() =>
      page
        .locator('.gauge-speed')
        .evaluate((node) => (node as SVGCircleElement).style.strokeDasharray),
    )
    .toMatch(/^52\.0\d+,?\s*47\.9\d+$/)
  await expect
    .poll(() =>
      page.locator('.throttle-gauge .pedal-segments [data-active]').count(),
    )
    .toBe(9)
  await expect
    .poll(() =>
      page
        .locator('.gauge-rpm-arc')
        .evaluate((node) => (node as SVGCircleElement).style.strokeDasharray),
    )
    .toMatch(/^44\.7\d+,?\s*55\.2\d+$/)
  await expect(page.locator('.gear-plinth')).toContainText('4')
  await expect(page.locator('.brake-gauge .pedal-label')).toContainText('OFF')
  await expect(page.locator('.drs-readout')).toHaveAttribute(
    'data-state',
    'active',
  )
  await expect
    .poll(() =>
      page
        .locator('.gauge-speed')
        .evaluate((node) => (node as SVGCircleElement).style.strokeDashoffset),
    )
    .toBe('0')
  await expect(page.locator('.gauge-needle')).toHaveAttribute(
    'transform',
    'rotate(412.5 200 201)',
  )
  await expect(
    page.locator('.race-driver-row').first().locator('.race-driver-tyre'),
  ).toHaveText('S')
  await expect(
    page.locator('.race-driver-row').first().locator('.race-driver-status'),
  ).toHaveText('TRACK')
  await page.locator('.telemetry-rail').screenshot({
    path: testInfo.outputPath('telemetry-cockpit.png'),
  })
  await expect(page.locator('.pit-stop-log')).toContainText('LAP 1')
  await page.locator('.pit-stop-log button').click()
  await expect(page.locator('.telemetry-session-state')).toContainText(
    'PIT LANE · RECORDED VISIT',
  )
  await expect(
    page.locator('[data-driver="44"] .race-pit-indicator'),
  ).toHaveCSS('opacity', '1')
  await expect(
    page.locator('.race-driver-row').first().locator('.race-driver-status'),
  ).toHaveText('PIT')
  await page.locator('.race-timeline-scrubber').evaluate((node) => {
    const range = node as HTMLInputElement
    range.value = '311000'
    range.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await expect(
    page.locator('[data-driver="44"] .race-pit-indicator'),
  ).toHaveCSS('opacity', '0')
  await expect(
    page.locator('.race-driver-row').first().locator('.race-driver-status'),
  ).toHaveText('TRACK')
  await page.locator('.race-timeline-scrubber').evaluate((node) => {
    const range = node as HTMLInputElement
    range.value = '0'
    range.dispatchEvent(new Event('input', { bubbles: true }))
  })
  if ((await page.evaluate(() => innerWidth)) >= 1200) {
    expect(
      await page
        .locator('.telemetry-rail')
        .evaluate((node) => node.getBoundingClientRect().width),
    ).toBeGreaterThan(400)
  }
  if (testInfo.project.name === 'desktop') {
    await page.getByRole('button', { name: 'Play replay' }).click()
    const frameRate = await page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          let firstFrame: number | null = null
          let frameCount = 0
          const sample = (now: number) => {
            firstFrame ??= now
            frameCount++
            const elapsed = now - firstFrame
            if (elapsed >= 1_000) resolve((frameCount * 1_000) / elapsed)
            else requestAnimationFrame(sample)
          }
          requestAnimationFrame(sample)
        }),
    )
    await page.getByRole('button', { name: 'Pause replay' }).click()
    console.log(`Desktop replay animation: ${frameRate.toFixed(1)} FPS`)
    expect(frameRate).toBeGreaterThan(0)
  }
  await expect(
    page.locator('.race-driver-row').nth(1).locator('.race-driver-result'),
  ).toHaveText('DNF')
  await expect(page.locator('.telemetry-session-state')).toContainText('SOFT')
  await expect(
    page
      .getByRole('img', {
        name: 'Recorded speed 250 kilometers per hour, throttle 87 percent',
      })
      .getByText('9,328', { exact: true }),
  ).toBeVisible()
  if (testInfo.project.name === 'wide') {
    await page.evaluate(() => {
      window.scrollTo(0, 0)
      if (document.activeElement instanceof HTMLElement)
        document.activeElement.blur()
    })
    await page.locator('.race-control-deck').screenshot({
      path: testInfo.outputPath('race-control-deck.png'),
    })
  }
  await expect(page.getByRole('button', { name: 'Play replay' })).toBeEnabled()
  await expect(page.locator('.race-timeline-scrubber')).toHaveCount(1)
  await expect(page.locator('.race-seek-label')).toHaveCount(0)
  await expect(
    page.getByRole('combobox', { name: 'Replay speed' }),
  ).toHaveValue('1')
  await expect(
    page.getByRole('combobox', { name: 'Replay speed' }).locator('option'),
  ).toHaveText(['0.5×', '1×', '2×', '5×', '10×'])
  await expect(
    page.getByText(/usable location samples in this window/),
  ).toHaveCount(0)
  await expect(
    page.getByText('Flags & radio are not available in this replay'),
  ).toHaveCount(0)
  await page.getByRole('button', { name: /recorded events near/i }).click()
  await page.getByRole('button', { name: /Pit lane entry/ }).click()
  await expect(page.locator('.race-deck-time-meta b').first()).toHaveText(
    '5:00',
  )
  await page.getByRole('button', { name: 'Back 10 seconds' }).click()
  await expect(page.locator('.race-deck-time-meta b').first()).toHaveText(
    '4:50',
  )
  await page.getByRole('button', { name: 'Forward 10 seconds' }).click()
  await expect(page.locator('.race-deck-time-meta b').first()).toHaveText(
    '5:00',
  )
  await page.getByRole('combobox', { name: 'Replay speed' }).selectOption('5')
  await expect(
    page.getByRole('combobox', { name: 'Replay speed' }),
  ).toHaveValue('5')
  const lapJump = page.getByRole('combobox', { name: 'Jump to lap' })
  await expect(lapJump.locator('option')).toHaveText([
    'SELECT LAP',
    'LAP 01',
    'LAP 04',
  ])
  await lapJump.selectOption('4')
  await expect(page.locator('.race-deck-time-meta b').first()).toHaveText(
    '2:00',
  )
  await expect(page.locator('.race-deck-time-meta')).toContainText('LAP 4 / 4')
  await expect(lapJump).toHaveValue('')
  await page.getByRole('button', { name: 'Forward 10 seconds' }).click()
  await expect(page.locator('.race-deck-time-meta b').first()).toHaveText(
    '2:10',
  )
  await lapJump.selectOption('4')
  await expect(page.locator('.race-deck-time-meta b').first()).toHaveText(
    '2:00',
  )
  const scrubber = page.locator('.race-timeline-scrubber')
  const scrubberBounds = await scrubber.boundingBox()
  if (!scrubberBounds) throw new Error('Replay scrubber is not rendered')
  await page.mouse.move(
    scrubberBounds.x + 40,
    scrubberBounds.y + scrubberBounds.height / 2,
  )
  await page.mouse.down()
  await page.mouse.move(
    scrubberBounds.x + scrubberBounds.width * 0.6,
    scrubberBounds.y + scrubberBounds.height / 2,
    { steps: 8 },
  )
  await page.mouse.up()
  const scrubbedValue = Number(await scrubber.inputValue())
  expect(scrubbedValue).toBeGreaterThan(3_600_000)
  expect(scrubbedValue).toBeLessThan(4_800_000)
  await scrubber.focus()
  await page.keyboard.press('ArrowRight')
  await expect(scrubber).toHaveValue(String(scrubbedValue + 1))
  await page.locator('.race-driver-row').nth(1).click()
  await expect(page.locator('.race-driver-row').nth(1)).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(page.locator('[data-driver="16"]')).toHaveCount(0)
  await expect(
    page.getByRole('complementary', { name: 'Selected car telemetry' }),
  ).toContainText('SEC')
  await expect(
    page.locator('.race-driver-row').nth(1).locator('.race-driver-tyre'),
  ).toHaveText('H')
  await expect(page.locator('.telemetry-session-state')).toContainText('HARD')
  await expect(page.locator('.telemetry-session-state')).toContainText('DNF')
  await expect(page.locator('.telemetry-session-state')).toContainText(
    'FINAL RESULT',
  )
  const secondDriverStatus = page
    .locator('.race-driver-row')
    .nth(1)
    .locator('.race-driver-status')
  await expect(secondDriverStatus).toHaveAttribute('data-result', 'DNF')
  const resultBadge = await secondDriverStatus.evaluate((node) => ({
    width: window.innerWidth,
    pseudoContent: getComputedStyle(node, '::after').content,
  }))
  if (resultBadge.width <= 560) expect(resultBadge.pseudoContent).toBe('"DNF"')
  await page.locator('.race-timeline-scrubber').evaluate((input) => {
    const slider = input as HTMLInputElement
    slider.value = '12000'
    slider.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await expect(page.locator('.instrument-heading b')).toHaveText('NO SAMPLE')
  await expect(page.locator('.drs-readout')).toHaveAttribute(
    'data-state',
    'unavailable',
  )
  await expect(
    page.locator('.race-driver-row').first().locator('.race-driver-status'),
  ).toHaveText('NO DATA')
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true)
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

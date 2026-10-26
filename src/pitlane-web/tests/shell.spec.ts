import { test, expect } from '@playwright/test'

// Capability metadata only. These fixtures contain no invented race data.
const capabilities = {
  stage: 'foundation',
  modes: ['live', 'replay', 'telemetry', 'radio'].map((id) => ({
    id,
    status: 'notIntegrated',
    reason: 'Not integrated.',
  })),
}

test('navigation preserves honest empty states and browser history', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('**/api/capabilities', (route) =>
    route.fulfill({ json: capabilities }),
  )
  await page.goto('/')
  await expect(
    page.getByRole('heading', { name: 'Welcome to the pit wall.' }),
  ).toBeVisible()
  await expect(
    page.getByRole('img', { name: 'Illustrative circuit outline' }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Play replay', exact: true }),
  ).toBeDisabled()
  const nav = page.getByRole('navigation', { name: 'Main navigation' })
  for (const [label, hash, description] of [
    ['Live timing', 'live', 'A live data connection is not available yet.'],
    ['Race replay', 'replay', 'No historical session is loaded.'],
    ['Telemetry', 'telemetry', 'No driver telemetry is loaded.'],
    ['Team radio', 'radio', 'No radio clips are loaded.'],
  ]) {
    await nav.getByRole('link', { name: label }).click()
    await expect(page).toHaveURL(new RegExp(`#${hash}$`))
    await expect(
      page.getByRole('heading', { name: label, exact: true }),
    ).toBeVisible()
    await expect(page.getByText(description, { exact: false })).toBeVisible()
    await expect(nav.getByRole('link', { name: label })).toHaveAttribute(
      'aria-current',
      'page',
    )
  }
  await page.reload()
  await expect(
    page.getByRole('heading', { name: 'Team radio', exact: true }),
  ).toBeVisible()
  await page.goBack()
  await expect(
    page.getByRole('heading', { name: 'Telemetry', exact: true }),
  ).toBeVisible()
  await nav.getByRole('link', { name: 'Overview', exact: true }).click()
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true)
  await expect(
    page.getByText('API connected · Race data not integrated'),
  ).toBeVisible()
  expect(errors).toEqual([])
})

test('session dialog explains availability and restores keyboard focus', async ({
  page,
}) => {
  await page.route('**/api/capabilities', (route) =>
    route.fulfill({ json: capabilities }),
  )
  await page.goto('/')
  const trigger = page.getByRole('button', {
    name: 'Session library',
    exact: true,
  })
  await trigger.focus()
  await page.keyboard.press('Enter')
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(
    dialog.getByText('Historical session selection is coming next.', {
      exact: false,
    }),
  ).toBeVisible()
  await expect(
    dialog.getByRole('link', { name: 'Read about the data', exact: false }),
  ).toHaveAttribute('href', 'https://openf1.org/docs/')
  await page.keyboard.press('Escape')
  await expect(dialog).not.toBeVisible()
  await expect(trigger).toBeFocused()
})

test('API failure remains visible and retry recovers without inventing race data', async ({
  page,
}) => {
  let available = false
  await page.route('**/api/capabilities', (route) =>
    available
      ? route.fulfill({ json: capabilities })
      : route.fulfill({ status: 503, json: { title: 'Unavailable' } }),
  )
  await page.goto('/')
  await expect(
    page.getByText('API unavailable', { exact: false }),
  ).toBeVisible()
  await expect(page.getByText('No session connected')).toBeVisible()
  available = true
  await page.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(
    page.getByText('API connected · Race data not integrated'),
  ).toBeVisible()
  await expect(page.getByText('No session connected')).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Play replay', exact: true }),
  ).toBeDisabled()
})

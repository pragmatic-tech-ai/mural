import { test, expect, _electron as electron } from '@playwright/test'
import { join } from 'node:path'

const mainEntry = join(__dirname, '../out/main/index.js')

test('demo app boots, composes 6 group modules, and mounts the shell', async () => {
  // Strip ELECTRON_RUN_AS_NODE — when set (as it is in this dev shell), electron.exe
  // runs as plain Node, `electron.app` is undefined, and the process fails to launch.
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE

  const app = await electron.launch({
    args: [mainEntry, '--no-sandbox', '--disable-gpu'],
    env: env as Record<string, string>,
  })
  const win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')

  // The shell paints as SVG into #app — wait for the first frame.
  await expect.poll(async () =>
    win.evaluate(() => document.querySelectorAll('#app svg').length), { timeout: 30_000 },
  ).toBeGreaterThan(0)

  // Composition asserted end-to-end via the exposed Application.
  const names = await win.evaluate(() => {
    const a = (globalThis as unknown as { __demoApp: { Modules: Iterable<{ Name: string }> } }).__demoApp
    return [...a.Modules].map((m) => m.Name)
  })
  expect(names).toEqual([
    'Animation', 'Controls', 'Demos', 'Patterns', 'Styles & Triggers', 'Shape library',
  ])

  await app.close()
})

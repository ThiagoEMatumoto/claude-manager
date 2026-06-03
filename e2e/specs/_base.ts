import { test as base } from '@playwright/test'
import { launchApp, type LaunchResult } from '../driver/launch'

// Fixture que lança o app (contra a cópia dos dados) por teste e fecha no fim.
// Os specs recebem `cm` = { app, page, userDataCopy }.
export const test = base.extend<{ cm: LaunchResult }>({
  cm: async ({}, use) => {
    const launched = await launchApp()
    await use(launched)
    await launched.app.close()
  },
})

export { expect } from '@playwright/test'

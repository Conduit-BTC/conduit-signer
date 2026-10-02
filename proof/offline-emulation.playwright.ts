import { expect, test } from "@playwright/test"

for (const port of [7030, 7031]) {
  test(`offline emulation reload on ${port} (retains WebKit reproduction)`, async ({
    page,
    context,
  }) => {
    await page.goto(`http://localhost:${port}`)
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready
    })
    await page
      .frames()
      .find((f) => f.url() === "http://localhost:7032/")!
      .evaluate(async () => {
        await navigator.serviceWorker.ready
      })
    await page.reload()
    await expect(page.frameLocator("iframe").locator("#state")).toContainText(
      "No stored record",
    )
    expect(
      await page.evaluate(() => !!navigator.serviceWorker.controller),
    ).toBe(true)
    await context.setOffline(true)
    // Keep this assertion: a known emulator failure is not a device pass.
    // https://github.com/microsoft/playwright/issues/42775
    await page.reload()
    await expect(page.frameLocator("iframe").locator("#state")).toContainText(
      "No stored record",
    )
  })
}

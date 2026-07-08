import { expect, test } from "@playwright/test"

/**
 * Exercises the full stack `global-setup.ts` boots: the real server (built
 * client + migrations run at startup) serving the page, the `ServerInfo`
 * rpc over the `/rpc` websocket, and the client rendering it. Runs under
 * both the chromium and webkit projects (see `playwright.config.ts`).
 */
test("renders the rpc-delivered server SHA inside a shadcn/ui Card", async ({ page }) => {
  const baseUrl = process.env.E2E_BASE_URL
  const expectedSha = process.env.E2E_RELEASE_SHA
  if (baseUrl === undefined || expectedSha === undefined) {
    throw new Error("E2E_BASE_URL / E2E_RELEASE_SHA are unset — did global-setup.ts run?")
  }

  await page.goto(baseUrl)

  // `ServerInfoCard` renders a shadcn/ui `Card` (packages/client/src/components/ui/card.tsx).
  const card = page.getByTestId("server-info-card")
  await expect(card).toBeVisible()

  // The sha rendered inside it must be the one `global-setup.ts` handed the
  // server via `RELEASE_SHA` — proving it round-tripped through the
  // `ServerInfo` rpc rather than being hardcoded in the client.
  const shaCell = page.getByTestId("server-info-sha")
  await expect(shaCell).toHaveText(expectedSha)
})

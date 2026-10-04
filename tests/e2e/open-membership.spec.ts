import { MAX_OWNED_ORGANIZATIONS } from "../../src/domain/membership";
import { CUSTOMER_A_ID, CUSTOMER_A_NAME } from "../fixtures/scenario";
import { expect, test } from "./fixtures";

const PASSWORD = "open-membership-password";

/**
 * Open membership (D32): the mode this application may or may not ship in, proven either
 * way. These run against a server started with that mode; `playwright.config.ts` decides
 * which run that is.
 */
test(
  "a newcomer creates an organization of their own: bounded, and isolated from everyone else's",
  { tag: "@open" },
  async ({ baseURL, browser, reset }, testInfo) => {
    void reset;
    // A retry reuses the database, and the ownership bound counts what the first attempt
    // created — so each attempt is a different person.
    const email = `newcomer-${testInfo.retry}@example.invalid`;
    const context = await browser.newContext({ baseURL });
    const page = await context.newPage();
    try {
      const registered = await page.request.post(
        "/_agent-native/auth/register",
        { data: { email, password: PASSWORD } },
      );
      expect(registered.status(), await registered.text()).toBe(200);
      const loggedIn = await page.request.post("/_agent-native/auth/login", {
        data: { email, password: PASSWORD },
      });
      expect(loggedIn.status()).toBe(200);

      // Nobody is given an organization they did not ask for.
      const before = (await (
        await page.request.get("/_agent-native/org/me")
      ).json()) as {
        orgId?: string | null;
        access?: { orgCreation?: string };
      };
      expect(before.orgId).toBeNull();
      expect(before.access?.orgCreation).toBe("open");
      expect(
        (
          await page.request.get("/_agent-native/actions/list-customers")
        ).status(),
      ).toBe(403);

      // The application offers the way in instead of a dead end.
      await page.goto("/");
      await page.getByLabel("Organization name").fill("Newcomer Events");
      await page.getByRole("button", { name: "Create organization" }).click();
      await expect(
        page.getByRole("banner").first().getByText("Newcomer Events"),
      ).toBeVisible();

      // Theirs, and only theirs.
      const customers = await page.request.get(
        "/_agent-native/actions/list-customers",
      );
      expect(customers.status(), await customers.text()).toBe(200);
      expect(await customers.text()).not.toContain(CUSTOMER_A_NAME);
      const foreign = await page.request.get(
        `/_agent-native/actions/get-customer?customerId=${CUSTOMER_A_ID}`,
      );
      expect(foreign.status()).toBe(404);
      const created = await page.request.post(
        "/_agent-native/actions/create-customer",
        { data: { name: "Newcomer's first customer" } },
      );
      expect(created.status(), await created.text()).toBe(200);

      // The ways in that stay closed in every mode.
      for (const [method, pathname] of [
        ["POST", "/_agent-native/org/unmatched-framework-tail"],
        ["POST", "/_agent-native/org/join-by-domain"],
        ["PUT", "/_agent-native/org/domain"],
      ] as const) {
        const response = await page.request.fetch(pathname, {
          method,
          data: {
            name: "Side Door",
            orgId: "org_acme",
            domain: "example.invalid",
          },
        });
        expect(response.status(), `${method} ${pathname}`).toBe(403);
      }

      // Bounded: one organization exists already.
      for (let owned = 1; owned < MAX_OWNED_ORGANIZATIONS; owned += 1) {
        const more = await page.request.post("/_agent-native/org", {
          data: { name: `Newcomer Events ${owned + 1}` },
        });
        expect(more.status(), await more.text()).toBe(200);
      }
      const tooMany = await page.request.post("/_agent-native/org", {
        data: { name: "One Too Many" },
      });
      expect(tooMany.status()).toBe(403);
    } finally {
      await context.close();
    }
  },
);

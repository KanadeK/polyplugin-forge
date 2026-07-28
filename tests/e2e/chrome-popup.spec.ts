import { expect, test } from "@playwright/test";

import { startFixtureServer } from "./fixture-server.js";

let baseURL = "";
let closeFixture: (() => Promise<void>) | undefined;

test.beforeAll(async () => {
  const fixture = await startFixtureServer();
  baseURL = fixture.baseURL;
  closeFixture = fixture.close;
});

test.afterAll(async () => {
  await closeFixture?.();
});

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const messages: unknown[] = [];
    Reflect.set(globalThis, "__ppfMessages", messages);
    Reflect.set(globalThis, "chrome", {
      runtime: {
        sendMessage(message: {
          readonly name?: unknown;
        }): Promise<{ readonly greeting: string }> {
          messages.push(message);
          if (message.name === "failure") {
            return Promise.reject(new Error("deterministic fixture failure"));
          }
          const name =
            typeof message.name === "string" && message.name.trim().length > 0
              ? message.name.trim()
              : "friend";
          return Promise.resolve({ greeting: `Hello, ${name}!` });
        }
      }
    });
  });
});

test("popup click changes meaningful state with accessible controls", async ({
  page
}) => {
  await page.goto(`${baseURL}/chrome/popup.html`);

  await expect(
    page.getByRole("heading", { level: 1, name: "Hello Chrome" })
  ).toBeVisible();
  const input = page.getByLabel("Name to greet");
  const button = page.getByRole("button", { name: "Say hello" });
  const output = page.getByRole("status");

  await expect(input).toHaveAttribute("maxlength", "80");
  await expect(output).toHaveAttribute("aria-live", "polite");
  await expect(output).toHaveAttribute("aria-atomic", "true");
  const initialOutput = await output.textContent();

  await input.fill("Ada");
  await button.click();

  await expect(output).toHaveText("Hello, Ada!");
  await expect(output).not.toHaveText(initialOutput ?? "");
  await expect(button).toBeEnabled();
  await expect
    .poll(() =>
      page.evaluate(() =>
        JSON.stringify(Reflect.get(globalThis, "__ppfMessages"))
      )
    )
    .toBe('[{"type":"greet","name":"Ada"}]');
});

test("popup supports keyboard operation and fits its narrow popup viewport", async ({
  page
}) => {
  await page.setViewportSize({ width: 360, height: 480 });
  await page.goto(`${baseURL}/chrome/popup.html`);

  const input = page.getByLabel("Name to greet");
  const button = page.getByRole("button", { name: "Say hello" });
  await input.focus();
  await expect(input).toBeFocused();
  await input.fill("Grace");
  await input.press("Enter");

  await expect(page.getByRole("status")).toHaveText("Hello, Grace!");

  const layout = await page.evaluate(() => {
    const main = document.querySelector("main");
    const labelledBy = main?.getAttribute("aria-labelledby");
    const buttonElement = document.querySelector("button");
    const mainLabelExists =
      typeof labelledBy === "string" &&
      document.getElementById(labelledBy) !== null;
    return {
      viewportWidth: innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      labelledBy,
      hasLabelTarget:
        document.querySelector('label[for="greeting-name"]') !== null,
      mainLabelExists,
      buttonRight: buttonElement?.getBoundingClientRect().right ?? Infinity
    };
  });

  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.viewportWidth);
  expect(layout.buttonRight).toBeLessThanOrEqual(layout.viewportWidth);
  expect(layout.labelledBy).toBe("popup-title");
  expect(layout.hasLabelTarget).toBe(true);
  expect(layout.mainLabelExists).toBe(true);
  await expect(button).toBeVisible();
});

test("popup exposes a safe failure state without leaking internal errors", async ({
  page
}) => {
  await page.goto(`${baseURL}/chrome/popup.html`);
  await page.getByLabel("Name to greet").fill("failure");
  await page.getByRole("button", { name: "Say hello" }).click();

  const output = page.getByRole("status");
  await expect(output).toHaveText("Unable to create a greeting. Try again.");
  await expect(output).not.toContainText("deterministic fixture failure");
});

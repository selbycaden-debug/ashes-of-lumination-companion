import { expect, test } from "@playwright/test";
import fs from "node:fs";

const NAMES = ["Ava", "Ben", "Cara", "Dee", "Eli"];

async function submitForms(page, ids) {
  for (const id of ids) {
    const form = page.getByTestId(id);
    if (!(await form.count())) continue;
    const selects = form.locator("select");
    const count = await selects.count();
    for (let i = 0; i < count; i++) {
      const value = await selects.nth(i).locator("option").nth(1).getAttribute("value");
      if (value) await selects.nth(i).selectOption(value);
    }
    const button = form.getByTestId("submit-action");
    if (await button.count()) await button.click();
    const statement = form.getByTestId("submit-statement");
    if (await statement.count()) await statement.click();
  }
}

test("five phones sit a full night, day, and vote", async ({ browser }) => {
  fs.mkdirSync("screenshots", { recursive: true });
  const gmContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const gm = await gmContext.newPage();
  await gm.goto("/");
  await gm.getByTestId("gm-name").fill("Caden");
  await gm.getByTestId("create-game").click();
  await expect(gm.getByTestId("room-code")).toHaveText(/^[A-Z0-9]{4}$/);
  const code = (await gm.getByTestId("room-code").innerText()).trim();

  const players = [];
  for (const name of NAMES) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    await page.goto(`/?room=${code}`);
    await expect(page.getByTestId("join-code")).toHaveValue(code);
    await page.getByTestId("join-name").fill(name);
    await page.getByTestId("join-submit").click();
    await expect(page.getByText("Waiting for the deal")).toBeVisible();
    players.push(page);
  }

  await expect(gm.getByTestId("seat-list")).toContainText("Eli");
  await gm.getByTestId("open-rulebook").click();
  await expect(gm.getByTestId("rulebook-headline")).toHaveText("The main goal is always to kill the Ashen Tyrant.");
  await expect(gm.getByTestId("rulebook-band")).toContainText("Ashen: 1");
  await expect(gm.getByTestId("rulebook-band")).toContainText("Unaligned: 0");
  await expect(gm.getByTestId("rulebook-band")).toContainText("Lumen: 4");
  await gm.getByTestId("rulebook").getByRole("button", { name: "Close" }).click();
  await players[0].getByTestId("open-rulebook").click();
  await expect(players[0].getByTestId("rulebook")).toContainText("wins when every living player is the Syndic");
  await expect(players[0].getByTestId("rulebook")).toContainText("wins alone if last standing");
  await players[0].getByTestId("rulebook").getByRole("button", { name: "Close" }).click();
  await gm.getByTestId("setup-autofill").click();
  await expect(gm.getByRole("combobox").first()).not.toHaveValue("");
  await gm.getByTestId("deal").click();
  await expect(gm.getByTestId("gm-table")).toContainText("The Ashen Tyrant");
  await gm.getByTestId("open-rulebook").click();
  await expect(gm.getByTestId("rulebook-dealt")).toContainText("This deal:");
  await gm.getByTestId("rulebook").getByRole("button", { name: "Close" }).click();
  await expect(players[0].getByTestId("role-name")).toBeVisible();
  await gm.getByTestId("advance").click();
  await expect(gm.getByRole("heading", { name: /Ash Fall/ })).toBeVisible();
  await expect(players[0].getByTestId("reveal")).toHaveCount(0);
  await players[0].getByTestId("open-catalogue").click();
  await expect(players[0].getByTestId("catalogue")).toContainText("The Shadow Blade");
  await expect(players[0].getByTestId("catalogue")).toContainText("does not say which roles were dealt");
  await players[0].getByRole("button", { name: "Close" }).click();

  await gm.screenshot({ path: "screenshots/gm-phone.png", fullPage: true });
  await players[0].screenshot({ path: "screenshots/player-phone.png", fullPage: true });

  for (const page of players) {
    await page.getByRole("button", { name: "Act", exact: true }).click();
    const forms = page.locator("[data-testid^='form-']");
    const count = await forms.count();
    const ids = [];
    for (let i = 0; i < count; i++) ids.push(await forms.nth(i).getAttribute("data-testid"));
    await submitForms(page, ids);
  }
  await gm.getByTestId("advance").click();
  await expect(gm.getByRole("heading", { name: /Lumination/ })).toBeVisible();

  for (const page of players) {
    await page.getByRole("button", { name: "Act", exact: true }).click();
    await page.getByTestId("statement").fill("I woke with the light.");
    await submitForms(page, ["form-statement", "form-nomination"]);
  }
  await gm.getByTestId("advance").click();
  await expect(gm.getByRole("heading", { name: /Dawn Accord/ })).toBeVisible();

  for (const page of players) {
    await page.getByRole("button", { name: "Act", exact: true }).click();
    await submitForms(page, ["form-vote"]);
  }
  await gm.getByTestId("advance").click();

  await players[0].getByRole("button", { name: "Chat", exact: true }).click();
  await players[0].getByTestId("chat-input").fill("GM, it is Ava.");
  await players[0].getByTestId("chat-send").click();
  await gm.getByRole("button", { name: "Chat", exact: true }).click();
  await expect(gm.getByTestId("chat-log")).toContainText("GM, it is Ava.");

  await gm.getByRole("button", { name: "Ahsoka" }).click();
  const key = (await gm.getByTestId("ahsoka-key").innerText()).trim();
  const instructions = await gm.getByTestId("ahsoka-instructions").inputValue();
  expect(instructions).toContain(key);
  expect(instructions).toContain(`/api/agent/${code}/state`);
  const agent = await gm.request.get(`/api/agent/${code}/state`, { headers: { "X-Agent-Key": key } });
  expect(agent.ok()).toBeTruthy();
  const body = await agent.json();
  expect(body.summary).toContain("Phase");
  expect(body.state.players.some((p) => p.roleName === "The Ashen Tyrant")).toBeTruthy();
  const ava = body.state.players.find((p) => p.name === "Ava");
  const posted = await gm.request.post(`/api/agent/${code}/chat`, {
    headers: { "X-Agent-Key": key, "content-type": "application/json" },
    data: { playerId: ava.id, text: "Ahsoka is on the line." },
  });
  expect(posted.ok()).toBeTruthy();
  await expect(players[0].getByTestId("chat-log")).toContainText("Ahsoka (GM)");

  await gm.getByRole("button", { name: "Table", exact: true }).click();
  await expect(gm.getByTestId("gm-table")).toContainText("The Ashen Tyrant");
  await gm.screenshot({ path: "screenshots/gm-phone.png", fullPage: true });
  await players[0].getByRole("button", { name: "Role", exact: true }).click();
  await players[0].screenshot({ path: "screenshots/player-phone.png", fullPage: true });
});

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
  await gm.screenshot({ path: "/opt/cursor/artifacts/lobby.png" });
  await expect(gm.getByTestId("advanced-setup")).not.toHaveAttribute("open");
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
  await expect(gm.getByTestId("ashfall-summary")).toContainText("Nothing here has been applied");
  await expect(gm.getByTestId("night-progress")).toContainText("of");
  await expect(gm.getByRole("button", { name: "Ahsoka" })).toHaveCount(0);
  await players[0].getByTestId("open-catalogue").click();
  await expect(players[0].getByTestId("catalogue")).toContainText("The Shadow Blade");
  await expect(players[0].getByTestId("catalogue")).toContainText("does not say which roles were dealt");
  await players[0].getByTestId("more-info-the-shadow-blade").click();
  await expect(players[0].getByTestId("role-detail-the-shadow-blade")).toContainText("succession");
  await players[0].getByTestId("more-info-voice-of-the-accord").click();
  await expect(players[0].getByTestId("thin-role").first()).toBeVisible();
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
  await players[0].getByRole("button", { name: "Act", exact: true }).click();
  await players[0].screenshot({ path: "/opt/cursor/artifacts/night-action.png" });
  await expect.poll(async () => {
    for (const page of players) {
      if (await page.getByText("Action submitted").count()) return true;
    }
    return false;
  }).toBeTruthy();
  await gm.getByRole("button", { name: /Copy to/ }).first().click();
  await gm.getByTestId("copy-draft").fill("Your night action is recorded.");
  await gm.getByTestId("copy-send").click();
  await expect.poll(async () => {
    for (const page of players) {
      await page.getByRole("button", { name: "Chat", exact: true }).click();
      if (await page.getByText("Your night action is recorded.").count()) return true;
    }
    return false;
  }).toBeTruthy();
  await gm.getByTestId("advance").click();
  await expect(gm.getByRole("heading", { name: /Lumination/ })).toBeVisible();
  await gm.getByRole("button", { name: "Log", exact: true }).click();
  await expect(gm.getByTestId("game-log")).toContainText("Earlier");
  await gm.getByRole("button", { name: "Table", exact: true }).click();

  for (const page of players) {
    await page.getByRole("button", { name: "Act", exact: true }).click();
    await page.getByTestId("statement").fill("I woke with the light.");
    await submitForms(page, ["form-statement"]);
  }
  await gm.getByTestId("advance").click();
  await expect(gm.getByRole("heading", { name: /Dawn Accord/ })).toBeVisible();

  for (const page of players) {
    await page.getByRole("button", { name: "Act", exact: true }).click();
    await submitForms(page, ["form-nomination"]);
  }
  for (const page of players) {
    await expect(page.getByText("Nomination submitted")).toBeVisible();
    await submitForms(page, ["form-vote"]);
  }
  await players[0].screenshot({ path: "/opt/cursor/artifacts/vote.png" });
  await gm.getByRole("button", { name: "Vote", exact: true }).click();
  await expect(gm.getByTestId("voting-tab")).toContainText("Nominations");
  await gm.getByTestId("execution-choice").selectOption("NO_EXEC");
  await gm.getByTestId("advance").click();

  await players[0].getByRole("button", { name: "Chat", exact: true }).click();
  await expect(players[0].getByRole("button", { name: "Ashen" })).toHaveCount(0);
  await players[0].getByTestId("chat-input").fill("GM, it is Ava.");
  await players[0].getByTestId("chat-send").click();
  await gm.getByRole("button", { name: "Chat", exact: true }).click();
  await expect(gm.getByTestId("gm-chat-list")).toContainText("Ava");
  await expect(gm.getByTestId("chat-log")).toContainText("GM, it is Ava.");

  await gm.getByRole("button", { name: "Table", exact: true }).click();
  await expect(gm.getByTestId("gm-table")).toContainText("The Ashen Tyrant");
  await gm.screenshot({ path: "screenshots/gm-phone.png", fullPage: true });
  await players[0].getByRole("button", { name: "Role", exact: true }).click();
  await players[0].screenshot({ path: "screenshots/player-phone.png", fullPage: true });
});

test("GM kill and mire notes stay private, and the table does not end itself", async ({ browser }) => {
  const gmContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const gm = await gmContext.newPage();
  await gm.goto("/");
  await gm.getByTestId("gm-name").fill("Caden");
  await gm.getByTestId("create-game").click();
  const code = (await gm.getByTestId("room-code").innerText()).trim();
  const players = [];
  for (const name of NAMES) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    await page.goto(`/?room=${code}`);
    await page.getByTestId("join-name").fill(name);
    await page.getByTestId("join-submit").click();
    await expect(page.getByText("Waiting for the deal")).toBeVisible();
    players.push(page);
  }
  await gm.getByTestId("deal").click();
  const tyrant = gm.getByTestId("player-row").filter({ hasText: "The Ashen Tyrant" });
  await expect(tyrant).toBeVisible();
  await gm.getByTestId("gm-table").screenshot({ path: "/opt/cursor/artifacts/gm-phone.png" });
  await gm.setViewportSize({ width: 1280, height: 800 });
  await gm.screenshot({ path: "/opt/cursor/artifacts/gm-laptop.png" });
  await gm.setViewportSize({ width: 390, height: 844 });
  const tyrantName = (await tyrant.locator("h3").innerText()).trim().split(/\s+/)[0];
  const seat = players[NAMES.indexOf(tyrantName)];
  await seat.screenshot({ path: "/opt/cursor/artifacts/ashen-role-card.png" });
  await gm.getByTestId("timer-5").click();
  await expect(seat.getByTestId("countdown")).toHaveText(/\d+:\d\d/);
  await seat.screenshot({ path: "/opt/cursor/artifacts/player-timer.png" });
  await expect(tyrant.getByTestId("set-ash")).toBeDisabled();
  await expect(tyrant.getByTestId("gm-mire")).toBeDisabled();
  await expect(tyrant.getByTestId("set-ash")).toHaveAttribute("title", "Ashen are immune");
  await expect(tyrant.getByTestId("gm-mire")).toHaveAttribute("title", "Ashen are immune");
  await tyrant.getByTestId("gm-kill").click();
  await expect(tyrant.locator("h3")).toContainText("dead");
  await expect(tyrant.getByTestId("remnant-portrait")).toHaveAttribute("src", /the-ashen-tyrant-remnant\.webp/);
  await expect(seat.getByTestId("remnant-portrait")).toHaveAttribute("src", /the-ashen-tyrant-remnant\.webp/);
  await expect(gm.getByTestId("win-suggestion")).toContainText("Lumen win condition met");
  await expect(gm.locator("h1")).toContainText("Roles dealt");
  await expect(seat.getByTestId("public-log")).toContainText(`Died tonight: ${tyrantName}.`);
  await expect(seat.getByText("win condition met")).toHaveCount(0);
  await gm.getByTestId("gm-table").screenshot({ path: "/opt/cursor/artifacts/gm-table-remnant.png" });
  await seat.screenshot({ path: "/opt/cursor/artifacts/dead-player-role-card.png" });
  await seat.screenshot({ path: "/opt/cursor/artifacts/remnant-card.png" });
  await tyrant.getByTestId("undo-kill").click();
  await expect(tyrant.locator("h3")).not.toContainText("dead");
  await expect(tyrant.getByTestId("portrait")).toHaveAttribute("src", /\/portraits\/the-ashen-tyrant\.webp/);
  await expect(seat.getByTestId("portrait")).toHaveAttribute("src", /\/portraits\/the-ashen-tyrant\.webp/);
  await expect(gm.getByTestId("win-suggestion")).toHaveCount(0);
  await expect(seat.getByTestId("public-log")).toHaveCount(0);

  const lumen = gm.getByTestId("player-row").filter({ hasText: "· Lumen" }).first();
  const lumenName = (await lumen.locator("h3").innerText()).trim().split(/\s+/)[0];
  const lumenPage = players[NAMES.indexOf(lumenName)];
  await lumen.getByTestId("gm-mire").click();
  await expect(lumen).toContainText("Mire note");
  await expect(lumenPage.getByText("Mire note")).toHaveCount(0);
  await lumen.getByTestId("undo-mire").click();
  await expect(lumen.getByText("Mire note")).toHaveCount(0);
  await lumenPage.screenshot({ path: "/opt/cursor/artifacts/lumen-role-card.png" });
  await lumenPage.getByTestId("open-catalogue").click();
  await expect(lumenPage.getByTestId("catalogue-Lumen").getByTestId("symbol-symbol-lumen-128")).toHaveAttribute("src", /symbol-lumen-128\.webp\?v=/);
  await expect(lumenPage.getByTestId("catalogue-Unaligned").getByTestId("symbol-symbol-unaligned-128")).toHaveAttribute("src", /symbol-unaligned-128\.webp\?v=/);
  await lumenPage.getByTestId("catalogue-Lumen").screenshot({ path: "/opt/cursor/artifacts/all-roles-lumen.png" });
  await lumenPage.getByTestId("catalogue-Unaligned").scrollIntoViewIfNeeded();
  await lumenPage.getByTestId("catalogue-Unaligned").screenshot({ path: "/opt/cursor/artifacts/all-roles-unaligned.png" });
  await lumenPage.getByTestId("catalogue").screenshot({ path: "/opt/cursor/artifacts/all-roles-symbols.png" });

  await gm.getByTestId("end-game").click();
  await gm.getByTestId("end-side").selectOption("lumen");
  await gm.getByTestId("end-confirm").check();
  await gm.getByTestId("end-submit").click();
  await expect(gm.locator("h1")).toContainText("Ended");
  await expect(gm.getByTestId("recap")).toContainText("The Ashen Tyrant");
  await expect(seat.getByTestId("recap")).toContainText("The Ashen Tyrant");
  await expect(gm.getByTestId("recap-download")).toBeVisible();
  await seat.screenshot({ path: "/opt/cursor/artifacts/player-recap.png" });
});

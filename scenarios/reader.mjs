/** A deterministic, isolated reader persona. Mocked transport; no research calls or credentials. */
import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
const origin = new URL(process.argv[2] ?? "http://127.0.0.1:40510");
if (!["localhost", "127.0.0.1"].includes(origin.hostname))
  throw new Error("The reader fixture runs only against a local app.");
const snapshot = JSON.parse(
  await readFile(new URL("../examples/discover.json", import.meta.url), "utf8"),
);
snapshot.simulation = true;
snapshot.sources[0].title = "Synthetic extraction fixture";
snapshot.sources[0].relevance = "Synthetic evidence for inspecting the reading interface.";
snapshot.sources[0].excerpt =
  '#### 1. INTRODUCTION\n\nThe fixture preserves a numerical result of 24.01 MWh and 10<sup>3</sup> cycles, with H<sub>2</sub>O. [\\[1\\]](#page-12-0)\n\n<FG id="mineru-table-0008"><T><table><tr><td>Case</td><td>ENS (MWh)</td></tr><tr><td>B3 reference</td><td>24.01</td></tr></table></T></FG>\n\n[_page_18_Figure_1.png]: A retained figure caption.\n\n' +
  "Additional retained context for checking expansion and reading position. ".repeat(35) +
  "<script>window.excerptExecuted=true</script>";
// Synthetic list-wrapped extraction keeps this scenario independent of private source text.
const savedTable = `['<FG id="synthetic-cycles"><T><table><tr><td>Material</td><td>No. of cycles</td></tr><tr><td>Synthetic sample</td><td>100</td></tr></table></T></FG>']`;
snapshot.sources[0].excerpt += "\n\n" + savedTable;
const result = { persona: "reader", transport: "synthetic fixture", checks: [], paidCalls: 0 };
await mkdir(new URL("../.artifacts/reader/", import.meta.url), { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  for (const [name, width, height, scheme] of [
    ["desktop", 1360, 1000, "light"],
    ["mobile", 390, 844, "dark"],
  ]) {
    const context = await browser.newContext({
      viewport: { width, height },
      colorScheme: scheme,
      reducedMotion: "reduce",
    });
    context.setDefaultTimeout(10000);
    console.log("Checking " + name);
    let taskReads = 0;
    await context.route("**/api/research/**", async (route) => {
      assert.equal(route.request().method(), "GET", "Reader persona must never submit paid work");
      const path = new URL(route.request().url()).pathname;
      if (path === `/api/research/tasks/${snapshot.id}`) {
        taskReads++;
        await route.fulfill({ json: snapshot });
      } else if (path === "/api/research/tasks") await route.fulfill({ json: [] });
      else await route.fulfill({ status: 404 });
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") console.error(message.text());
    });
    await page.goto(new URL(`/tasks/${snapshot.id}`, origin).href);
    await page.getByRole("heading", { level: 1, name: snapshot.input.question }).waitFor();
    const initialReads = taskReads;
    await page.getByRole("link", { name: "Open source 1", exact: true }).first().click();
    const panel = page.getByRole("dialog");
    await panel
      .getByRole("heading", { name: "Synthetic extraction fixture", exact: true })
      .waitFor();
    await panel.getByRole("columnheader", { name: "ENS (MWh)" }).waitFor();
    const box = await panel.boundingBox();
    assert.ok(box && box.width <= width && (width < 600 || box.width >= 590));
    const body = panel.locator(".source-extract-body");
    assert.ok(!(await body.innerText()).includes("mineru-table"));
    assert.ok(!(await body.innerText()).includes("_page_"));
    assert.ok(!(await body.innerText()).includes("####"));
    assert.ok((await body.innerText()).includes("10³ cycles, with H₂O"));
    assert.equal(await page.evaluate(() => window.excerptExecuted), undefined);
    await panel.getByRole("button", { name: "Read more extracted text" }).click();
    assert.equal(
      await panel.getByRole("button", { name: "Show less" }).getAttribute("aria-expanded"),
      "true",
    );
    await panel.getByRole("columnheader", { name: "No. of cycles", exact: true }).waitFor();
    await page.screenshot({
      path: new URL(`../.artifacts/reader/${name}.png`, import.meta.url).pathname,
    });
    await panel.getByRole("button", { name: "Close source" }).click();
    await panel.waitFor({ state: "hidden" });
    assert.equal(
      taskReads - initialReads,
      0,
      "Opening and closing a source must reuse the task snapshot",
    );
    await context.setOffline(true);
    assert.ok(
      await page.getByRole("heading", { name: snapshot.input.question, exact: true }).isVisible(),
    );
    await context.setOffline(false);
    await page.reload();
    await page.getByRole("heading", { level: 1, name: snapshot.input.question }).waitFor();
    assert.equal(errors.length, 0, errors.join("\n"));
    result.checks.push({
      viewport: name,
      excerpt: "formatted and expandable",
      width: box.width,
      sourceOpenAdditionalReads: 0,
      refresh: "restored",
      offline: "cached reading retained",
    });
    await context.close();
  }
  await writeFile(
    new URL("../.artifacts/reader/result.json", import.meta.url),
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
}

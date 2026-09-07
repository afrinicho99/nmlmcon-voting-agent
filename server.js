const express = require("express");
const { chromium } = require("playwright");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 10000;
const VOTE_SECRET = process.env.VOTE_SECRET;

let voteInProgress = false;
let voteCompleted = false;

app.get("/", (req, res) => {
  res.json({
    service: "NMLMCON Voting Agent",
    status: voteCompleted ? "vote_completed" : "ready",
  });
});

app.post("/vote", async (req, res) => {
  try {
    // Protect the endpoint.
    if (req.headers.authorization !== `Bearer ${VOTE_SECRET}`) {
      return res.status(401).json({
        success: false,
        error: "Unauthorized",
      });
    }

    // Never allow concurrent voting jobs.
    if (voteInProgress) {
      return res.status(409).json({
        success: false,
        error: "A voting operation is already running.",
      });
    }

    // Prevent accidental second submission.
    if (voteCompleted) {
      return res.status(409).json({
        success: false,
        error: "The vote has already been completed.",
      });
    }

    const nomineeCode = String(req.body.nomineeCode || "19");
    const nomineeName =
      req.body.nomineeName || "GLADYS BEDIAKO";

    voteInProgress = true;

    console.log(
      `Starting authorized vote for ${nomineeName} (${nomineeCode})`
    );

    const browser = await chromium.launch({
      headless: true,
    });

    const context = await browser.newContext({
      viewport: {
        width: 1440,
        height: 900,
      },
    });

    const page = await context.newPage();

    try {
      await page.goto(
        "https://mohannualcon.com/online-voting",
        {
          waitUntil: "domcontentloaded",
          timeout: 60000,
        }
      );

      await page.waitForTimeout(5000);

      /*
       * Temporary selector logic.
       *
       * We will replace this with the exact selector once
       * we inspect the rendered DOM.
       */
      const pageText = await page.locator("body").innerText();

      if (!pageText.includes(nomineeCode)) {
        throw new Error(
          `Nominee code ${nomineeCode} was not found on the page.`
        );
      }

      console.log("Nominee code found.");

      // Find Select Nominee button associated with the nominee.
      const nomineeText = page.getByText(
        nomineeCode,
        { exact: false }
      ).first();

      await nomineeText.scrollIntoViewIfNeeded();

      const card = nomineeText.locator(
        "xpath=ancestor::*[.//button][1]"
      );

      const selectButton = card.getByRole(
        "button",
        {
          name: /select nominee/i,
        }
      ).first();

      await selectButton.click();

      console.log("Nominee selected.");

      /*
       * IMPORTANT:
       * If the site presents CAPTCHA, OTP, or another
       * verification challenge, stop instead of attempting
       * to bypass it.
       */

      await page.waitForTimeout(1500);

      const body = await page.locator("body").innerText();

      if (
        /captcha|verification code|otp|one-time password/i.test(body)
      ) {
        throw new Error(
          "Manual verification is required. Voting stopped."
        );
      }

      const confirmButton = page
        .getByRole("button", {
          name: /confirm|submit vote|cast vote|vote now/i,
        })
        .first();

      if (!(await confirmButton.isVisible().catch(() => false))) {
        throw new Error(
          "Confirmation button was not found. Voting stopped safely."
        );
      }

      await confirmButton.click();

      console.log("Vote submission initiated.");

      await page.waitForTimeout(3000);

      const resultText =
        await page.locator("body").innerText();

      const successful =
        /vote submitted|vote successful|successfully voted|vote recorded|thank you for voting/i.test(
          resultText
        );

      if (!successful) {
        throw new Error(
          "Could not verify successful vote submission."
        );
      }

      voteCompleted = true;

      console.log("VOTE SUCCESSFULLY COMPLETED");

      return res.json({
        success: true,
        nomineeCode,
        nomineeName,
        message: "Vote successfully recorded.",
      });
    } finally {
      await browser.close();
    }
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      success: false,
      error: error.message,
    });
  } finally {
    voteInProgress = false;
  }
});

app.listen(PORT, () => {
  console.log(`Voting agent running on port ${PORT}`);
});
app.get("/health", (req, res) => {
  res.status(200).send("NMLMCON VOTING AGENT IS ALIVE");
});

app.listen(PORT, () => {
  console.log(`Voting agent running on port ${PORT}`);
});
app.get("/test-browser", async (req, res) => {
  let browser;

  try {
    console.log("Starting Playwright browser test...");

    browser = await chromium.launch({
      headless: true,
    });

    const page = await browser.newPage();

    await page.goto("https://mohannualcon.com/online-voting", {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });

    await page.waitForTimeout(5000);

    const title = await page.title();
    const url = page.url();
    const bodyText = await page.locator("body").innerText();

    console.log("Browser test completed.");
    console.log("Page title:", title);
    console.log("Page URL:", url);
    console.log("Page text length:", bodyText.length);

    res.json({
      success: true,
      title,
      url,
      textLength: bodyText.length,
      message: "Playwright successfully opened the voting page.",
    });

  } catch (error) {
    console.error("Browser test failed:", error);

    res.status(500).json({
      success: false,
      error: error.message,
    });

  } finally {
    if (browser) {
      await browser.close();
    }
  }
});

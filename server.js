const express = require("express");
const { chromium } = require("playwright");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 10000;
const VOTE_SECRET = process.env.VOTE_SECRET;

let voteInProgress = false;
let voteCompleted = false;


// ============================================================
// HEALTH CHECK
// ============================================================

app.get("/", (req, res) => {
  res.json({
    service: "NMLMCON Voting Agent",
    status: voteCompleted ? "vote_completed" : "ready",
  });
});


// ============================================================
// INSPECT VOTING PAGE
// DOES NOT CLICK OR SUBMIT ANYTHING
// ============================================================

app.get("/inspect-voting-page", async (req, res) => {
  let browser;

  try {
    console.log("Starting voting-page inspection...");

    browser = await chromium.launch({
      headless: true,
    });

    const page = await browser.newPage({
      viewport: {
        width: 1440,
        height: 900,
      },
    });

    await page.goto(
      "https://mohannualcon.com/online-voting",
      {
        waitUntil: "domcontentloaded",
        timeout: 60000,
      }
    );

    // Allow the JavaScript application to render.
    await page.waitForTimeout(5000);

    const data = await page.evaluate(() => {

      const buttons = [...document.querySelectorAll("button")]
        .map((button, index) => ({
          index,
          text: button.innerText.trim(),
          ariaLabel: button.getAttribute("aria-label"),
          disabled: button.disabled,
          className:
            typeof button.className === "string"
              ? button.className
              : "",
        }))
        .filter(button => button.text);

      const inputs = [...document.querySelectorAll("input")]
        .map((input, index) => ({
          index,
          type: input.type,
          name: input.name,
          placeholder: input.placeholder,
        }));

      const links = [...document.querySelectorAll("a")]
        .map((link, index) => ({
          index,
          text: link.innerText.trim(),
          href: link.href,
        }))
        .filter(link => link.text);

      return {
        title: document.title,
        url: location.href,

        text: document.body.innerText,

        buttons,
        inputs,
        links,
      };
    });

    console.log(
      `Inspection complete. Found ${data.buttons.length} buttons.`
    );

    res.json({
      success: true,
      data,
    });

  } catch (error) {

    console.error(
      "Voting-page inspection failed:",
      error
    );

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


// ============================================================
// VOTE ENDPOINT
// ============================================================

app.post("/vote", async (req, res) => {

  try {

    // Authorization
    if (
      req.headers.authorization !==
      `Bearer ${VOTE_SECRET}`
    ) {
      return res.status(401).json({
        success: false,
        error: "Unauthorized",
      });
    }


    // Prevent simultaneous voting jobs.
    if (voteInProgress) {
      return res.status(409).json({
        success: false,
        error:
          "A voting operation is already running.",
      });
    }


    // Prevent accidental second vote.
    if (voteCompleted) {
      return res.status(409).json({
        success: false,
        error:
          "The vote has already been completed.",
      });
    }


    const nomineeCode =
      String(req.body.nomineeCode || "19");

    const nomineeName =
      req.body.nomineeName ||
      "GLADYS BEDIAKO";


    voteInProgress = true;


    console.log(
      `Starting authorized vote for ${nomineeName} (${nomineeCode})`
    );


    const browser = await chromium.launch({
      headless: true,
    });


    const context =
      await browser.newContext({
        viewport: {
          width: 1440,
          height: 900,
        },
      });


    const page =
      await context.newPage();


    try {

      await page.goto(
        "https://mohannualcon.com/online-voting",
        {
          waitUntil: "domcontentloaded",
          timeout: 60000,
        }
      );


      await page.waitForTimeout(5000);


      const pageText =
        await page.locator("body").innerText();


      if (!pageText.includes(nomineeCode)) {

        throw new Error(
          `Nominee code ${nomineeCode} was not found on the page.`
        );

      }


      console.log(
        "Nominee code found."
      );


      const nomineeText =
        page.getByText(
          nomineeCode,
          {
            exact: false,
          }
        ).first();


      await nomineeText.scrollIntoViewIfNeeded();


      const card =
        nomineeText.locator(
          "xpath=ancestor::*[.//button][1]"
        );


      const selectButton =
        card.getByRole(
          "button",
          {
            name: /select nominee/i,
          }
        ).first();


      await selectButton.click();


      console.log(
        "Nominee selected."
      );


      await page.waitForTimeout(1500);


      const body =
        await page.locator("body").innerText();


      // Never attempt to bypass verification.
      if (
        /captcha|verification code|otp|one-time password/i.test(
          body
        )
      ) {

        throw new Error(
          "Manual verification is required. Voting stopped."
        );

      }


      const confirmButton =
        page
          .getByRole(
            "button",
            {
              name:
                /confirm|submit vote|cast vote|vote now/i,
            }
          )
          .first();


      if (
        !(await confirmButton.isVisible().catch(() => false))
      ) {

        throw new Error(
          "Confirmation button was not found. Voting stopped safely."
        );

      }


      await confirmButton.click();


      console.log(
        "Vote submission initiated."
      );


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


      console.log(
        "VOTE SUCCESSFULLY COMPLETED"
      );


      return res.json({

        success: true,

        nomineeCode,

        nomineeName,

        message:
          "Vote successfully recorded.",

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


// ============================================================
// START SERVER
// ============================================================

app.listen(PORT, () => {

  console.log(
    `Voting agent running on port ${PORT}`
  );

});

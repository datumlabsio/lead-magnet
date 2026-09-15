import "server-only";
import chromium from "@sparticuz/chromium";
import puppeteer, { type Browser } from "puppeteer-core";

/**
 * HTML to PDF, via headless Chrome.
 *
 * Chrome is the renderer because report templates are designed as HTML by
 * people using a design tool, and anything else would mean rebuilding each
 * design in a drawing API. Fidelity is the whole point of the deliverable.
 *
 * On Vercel this runs the @sparticuz/chromium build. Locally there is no such
 * binary, so it falls back to a Chrome already on the machine — set
 * CHROME_EXECUTABLE_PATH if yours is somewhere unusual.
 */

/** Where macOS and common Linux installs put a usable Chrome. */
const LOCAL_CHROME_PATHS = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
];

async function localChromePath(): Promise<string | undefined> {
  const configured = process.env.CHROME_EXECUTABLE_PATH;
  if (configured) return configured;

  const { access } = await import("node:fs/promises");
  for (const candidate of LOCAL_CHROME_PATHS) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next one.
    }
  }
  return undefined;
}

async function launch(): Promise<Browser> {
  // AWS_LAMBDA_FUNCTION_NAME is set inside a Vercel serverless function and on
  // Lambda, and nowhere on a developer's machine.
  const onLambda = Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME);

  if (!onLambda) {
    const executablePath = await localChromePath();
    if (!executablePath) {
      throw new Error(
        "No local Chrome found for PDF rendering. Install Chrome, or set CHROME_EXECUTABLE_PATH.",
      );
    }
    return puppeteer.launch({
      executablePath,
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
  }

  return puppeteer.launch({
    args: chromium.args,
    executablePath: await chromium.executablePath(),
    headless: true,
  });
}

export type PdfOptions = {
  /** CSS pixels. Defaults to US Letter at 96dpi, which is what the templates use. */
  width?: number;
  height?: number;
  /**
   * Keep CSS box-shadows. Off by default — see PRINT_FIXES below. Turn it on
   * only for a template you have checked renders correctly with them.
   */
  keepShadows?: boolean;
};

/**
 * Corrections applied to every template before printing.
 *
 * Chrome's PDF writer cannot rasterise a blurred box-shadow: instead of soft
 * depth it emits a hard grey rectangle, which on a card-heavy report reads as
 * broken banding behind every row. The shadow is decorative and these cards
 * carry borders of their own, so dropping it is strictly better output than
 * keeping a shadow that cannot render.
 *
 * Scoped deliberately narrowly. This is a workaround for one renderer defect,
 * not a licence to restyle a designer's work at print time.
 */
const PRINT_FIXES = "*,*::before,*::after{box-shadow:none !important;}";

/**
 * Renders a complete HTML document to PDF bytes.
 *
 * The HTML must be self-contained: fonts and images embedded as data URIs, no
 * remote assets. `scripts/embed-fonts.mjs` is what makes a handed-over template
 * satisfy that. Nothing here waits on the network, so a template that does
 * reference a remote asset will render without it rather than hanging.
 */
export async function renderPdf(html: string, options: PdfOptions = {}): Promise<Buffer> {
  const width = options.width ?? 816;
  const height = options.height ?? 1056;

  let browser: Browser | undefined;
  try {
    browser = await launch();
    const page = await browser.newPage();
    await page.setViewport({ width, height, deviceScaleFactor: 2 });

    // `domcontentloaded` rather than `networkidle`: the document carries its own
    // assets, so waiting for network quiet would only add a timeout to every render.
    const document_ = options.keepShadows ? html : `${html}<style>${PRINT_FIXES}</style>`;
    await page.setContent(document_, { waitUntil: "domcontentloaded" });

    // Embedded faces still have to be decoded before the first paint, and
    // skipping this is how a report goes out in fallback sans.
    await page.evaluate(() => document.fonts.ready);

    const pdf = await page.pdf({
      width: `${width}px`,
      height: `${height}px`,
      printBackground: true,
      // Honour the template's own @page rule where it sets one.
      preferCSSPageSize: true,
    });

    return Buffer.from(pdf);
  } finally {
    await browser?.close();
  }
}

import "server-only";
import { chromium } from "playwright";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const brandDirectory = () => join(process.cwd(), "public", "brand");
const fontWeights = ["Light", "Regular", "Medium", "Bold", "ExtraBold"];
let assetPromise: Promise<{ logo: string; fonts: Record<string, string> }> | undefined;
function loadAssets() {
  assetPromise ??= Promise.all([
    readFile(join(brandDirectory(), "eis-black.png")),
    Promise.all(fontWeights.map(weight => readFile(join(brandDirectory(), `HelveticaNowDisplay-${weight}.woff2`)))),
  ]).then(([logo, fonts]) => ({
    logo: "data:image/png;base64," + logo.toString("base64"),
    fonts: Object.fromEntries(fontWeights.map((weight,index) => [weight, "data:font/woff2;base64," + fonts[index].toString("base64")])),
  }));
  return assetPromise;
}
export async function pdfAssets(images: Record<string,string> = {}) {
  const { logo, fonts } = await loadAssets();
  return { logo, font: (weight: string) => fonts[weight], image: (id: string) => images[id] ?? "" };
}
let previousRender = Promise.resolve();
export async function renderPdf(html: string) {
  const wait = previousRender;
  let release!: () => void;
  previousRender = new Promise(resolve => { release = resolve; });
  await wait;
  try {
    return await printDocument(html);
  } finally {
    release();
  }
}

async function printDocument(html: string) {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, headless: true, timeout: 10000 });
  try {
    const page = await browser.newPage({ javaScriptEnabled: false, offline: true });
    await page.emulateMedia({ media: "print" });
    await page.setContent(html, { timeout: 20000, waitUntil: "load" });
    const [overflow, broken] = await page.evaluate(async () => {
      await document.fonts.ready;
      const overflow = [...document.querySelectorAll(".pagebody")]
        .flatMap((content,i) => content.scrollHeight > content.clientHeight + 2 || content.scrollWidth > content.clientWidth + 2 ? [i+1] : []);
      const broken = [...document.images].some(image => !image.naturalWidth);
      return [overflow, broken] as const;
    });
    if (broken) throw new Error("A document image could not be loaded.");
    if (overflow.length) throw new Error(`Content exceeds the layout on PDF page(s) ${overflow.join(", ")}. Shorten the content or split it across pages.`);
    return Buffer.from(await page.pdf({ preferCSSPageSize: true, printBackground: true }));
  } finally {
    await browser.close();
  }
}

// Renders build/appicon.png from the favicon. Run `npm run icons`, then
// `wails3 task common:generate:icons` in the repo root for icons.icns.
import sharp from "sharp";

const build = new URL("../../build/", import.meta.url);
const favicon = new URL("../public/favicon.svg", import.meta.url).pathname;

// macOS icons sit inside the canvas with a margin.
const app = await sharp(favicon, { density: 1200 }).resize(824, 824).png().toBuffer();
await sharp({ create: { width: 1024, height: 1024, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
  .composite([{ input: app, left: 100, top: 100 }])
  .png()
  .toFile(new URL("appicon.png", build).pathname);
console.log("wrote build/appicon.png");

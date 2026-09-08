/**
 * 이벤트다 포트폴리오 영상 렌더러.
 *
 * src/index.html 의 타임라인을 Chromium 으로 프레임 단위(seek)로 그린 뒤,
 * PNG 스트림을 그대로 ffmpeg 에 파이프해 MP4 로 인코딩한다.
 * 프레임을 디스크에 쌓지 않으므로 중간 산출물이 남지 않는다.
 *
 * 사용법:
 *   npm run render                 전체 렌더
 *   node render.mjs --preview 12   12초 지점 한 장만 PNG 로 저장 (구도 확인용)
 *   node render.mjs --to 20        앞 20초만 렌더 (빠른 확인용)
 */
import { chromium } from "playwright-core";
import ffmpegPath from "ffmpeg-static";
import { spawn } from "node:child_process";
import { mkdirSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WIDTH = 1920;
const HEIGHT = 1080;
const FPS = 30;

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? null : process.argv[i + 1];
}

/** playwright-core 는 브라우저를 내려받지 않는다. 이미 받아둔 캐시에서 찾아 쓴다. */
function findChromium() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const root = path.join(process.env.HOME ?? "", ".cache", "ms-playwright");
  if (!existsSync(root)) return null;
  const dirs = readdirSync(root)
    .filter((d) => d.startsWith("chromium-"))
    .sort()
    .reverse();
  for (const d of dirs) {
    for (const sub of ["chrome-linux64/chrome", "chrome-linux/chrome"]) {
      const p = path.join(root, d, sub);
      if (existsSync(p)) return p;
    }
  }
  return null;
}

const executablePath = findChromium();
if (!executablePath) {
  console.error(
    "Chromium 을 찾지 못했습니다. `npx playwright install chromium` 후 다시 실행하거나 CHROMIUM_PATH 를 지정하세요.",
  );
  process.exit(1);
}

const browser = await chromium.launch({ executablePath, args: ["--force-color-profile=srgb", "--font-render-hinting=none"] });
const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1 });
await page.goto("file://" + path.join(HERE, "src", "index.html"));
await page.waitForFunction(() => window.__ready === true);

const duration = await page.evaluate(() => window.DURATION);
const previewAt = arg("preview");

if (previewAt !== null) {
  mkdirSync(path.join(HERE, "out"), { recursive: true });
  await page.evaluate((t) => window.seek(t), Number(previewAt));
  const file = path.join(HERE, "out", `preview-${previewAt}s.png`);
  await page.screenshot({ path: file });
  console.log("saved", file);
  await browser.close();
  process.exit(0);
}

const until = arg("to") ? Number(arg("to")) : duration;
const total = Math.round(until * FPS);
mkdirSync(path.join(HERE, "out"), { recursive: true });
const outFile = path.join(HERE, "out", "eventda-portfolio.mp4");

const ff = spawn(ffmpegPath, [
  "-y",
  "-f", "image2pipe",
  "-framerate", String(FPS),
  "-i", "-",
  "-c:v", "libx264",
  "-preset", "slow",
  "-crf", "18",
  "-pix_fmt", "yuv420p",
  "-movflags", "+faststart",
  outFile,
], { stdio: ["pipe", "ignore", "pipe"] });

let ffErr = "";
ff.stderr.on("data", (c) => { ffErr += c.toString(); if (ffErr.length > 8000) ffErr = ffErr.slice(-4000); });

const started = Date.now();
for (let i = 0; i < total; i += 1) {
  const t = i / FPS;
  await page.evaluate((sec) => window.seek(sec), t);
  const buf = await page.screenshot({ type: "png" });
  if (!ff.stdin.write(buf)) {
    await new Promise((resolve) => ff.stdin.once("drain", resolve));
  }
  if (i % 150 === 0) {
    const pct = ((i / total) * 100).toFixed(1);
    const elapsed = ((Date.now() - started) / 1000).toFixed(0);
    console.log(`frame ${i}/${total} (${pct}%, ${elapsed}s)`);
  }
}
ff.stdin.end();

const code = await new Promise((resolve) => ff.on("close", resolve));
await browser.close();
if (code !== 0) {
  console.error(ffErr);
  process.exit(code);
}
console.log(`done: ${outFile} (${(total / FPS).toFixed(1)}s, ${total} frames)`);

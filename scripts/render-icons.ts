// scripts/render-icons.ts
//
// Render public/icon.svg to public/icon-192.png and public/icon-512.png
// using @resvg/resvg-js. Idempotent — running twice produces the same PNGs.
//
// Run: `npx tsx scripts/render-icons.ts`
import { Resvg } from "@resvg/resvg-js";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const SVG_PATH = resolve(process.cwd(), "public/icon.svg");
const OUTPUTS: Array<{ size: number; out: string }> = [
  { size: 192, out: resolve(process.cwd(), "public/icon-192.png") },
  { size: 512, out: resolve(process.cwd(), "public/icon-512.png") },
];

const svg = readFileSync(SVG_PATH, "utf8");
for (const { size, out } of OUTPUTS) {
  const resvg = new Resvg(svg, { fitTo: { mode: "width", value: size } });
  const png = resvg.render().asPng();
  writeFileSync(out, png);
  console.log(`wrote ${out} (${size}x${size}, ${png.byteLength} bytes)`);
}

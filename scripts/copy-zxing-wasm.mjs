#!/usr/bin/env node
// copy-zxing-wasm.mjs — copies zxing_reader.wasm from node_modules → public/zxing/
// Runs in postinstall. No-ops gracefully if zxing-wasm is not yet installed
// (e.g., before npm install in a fresh worktree — || true in worktree setup handles this).
import { copyFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const src  = resolve(__dirname, "../node_modules/zxing-wasm/dist/reader/zxing_reader.wasm");
const dest = resolve(__dirname, "../public/zxing/zxing_reader.wasm");

if (!existsSync(src)) {
  console.log("zxing-wasm not installed yet — skipping wasm copy (run npm install first)");
  process.exit(0); // graceful no-op
}

mkdirSync(resolve(__dirname, "../public/zxing"), { recursive: true });
copyFileSync(src, dest);
console.log(`✓ zxing_reader.wasm → public/zxing/`);

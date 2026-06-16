// src/lib/recap-render.tsx
// Single ImageResponse site for the weekly recap card feature.
// Module-scope font loading (DC-1 safe slice).
// Used by: /recap/card route, /recap/story/[slide] route, generate_recap_card MCP tool.
//
// Routes import renderRecapCard / renderRecapStorySlide and return them directly.
// The MCP tool calls Buffer.from(await renderRecapCard(...).arrayBuffer()).

import fs from "fs";
import path from "path";
import React from "react";
import { ImageResponse } from "next/og";
import type { WeeklyRecap, RecapTemplate, RecapSlide } from "@/lib/recap";
import { RecapCard, RecapStorySlide } from "@/lib/recap-card";

// ─── Font loading (DC-1 safe slice) ──────────────────────────────────────────
// Module scope — loaded once per cold start, reused across requests.

function loadFont(file: string): ArrayBuffer {
  const raw = fs.readFileSync(path.join(process.cwd(), "src/app/recap/fonts", file));
  // .buffer may be a shared pool; .slice() copies exactly the bytes we own.
  return raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer;
}

// Load fonts at module scope (cold-start cache).
// Missing files will throw here on first request — caught per-request.
let _fontGeistRegular: ArrayBuffer | null = null;
let _fontGeistSemiBold: ArrayBuffer | null = null;
let _fontDMSerifDisplay: ArrayBuffer | null = null;

function getFont(name: string, field: "reg" | "semi" | "serif"): ArrayBuffer | null {
  try {
    if (field === "reg") {
      if (!_fontGeistRegular) _fontGeistRegular = loadFont("Geist-Regular.ttf");
      return _fontGeistRegular;
    }
    if (field === "semi") {
      if (!_fontGeistSemiBold) _fontGeistSemiBold = loadFont("Geist-SemiBold.ttf");
      return _fontGeistSemiBold;
    }
    if (field === "serif") {
      if (!_fontDMSerifDisplay) _fontDMSerifDisplay = loadFont("DMSerifDisplay-Regular.ttf");
      return _fontDMSerifDisplay;
    }
  } catch {
    // Font file not available — omit from fonts array, satori uses fallback
    console.warn(`[recap-render] Font ${name} not found, skipping.`);
  }
  return null;
}

// ─── IMAGE_OPTIONS ────────────────────────────────────────────────────────────

function buildImageOptions(): ConstructorParameters<typeof ImageResponse>[1] {
  type FontEntry = { name: string; data: ArrayBuffer; weight: 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900; style: "normal" | "italic" };
  const fonts: FontEntry[] = [];

  const geistReg = getFont("GeistSans-regular", "reg");
  if (geistReg) {
    fonts.push({ name: "GeistSans", data: geistReg, weight: 400, style: "normal" });
  }
  const geistSemi = getFont("GeistSans-semibold", "semi");
  if (geistSemi) {
    fonts.push({ name: "GeistSans", data: geistSemi, weight: 600, style: "normal" });
  }
  const dmSerif = getFont("DMSerifDisplay-regular", "serif");
  if (dmSerif) {
    fonts.push({ name: "DMSerifDisplay", data: dmSerif, weight: 400, style: "normal" });
  }

  return {
    width: 1080,
    height: 1920,
    fonts,
  };
}

export const IMAGE_OPTIONS = buildImageOptions();

// ─── Render functions ─────────────────────────────────────────────────────────

/**
 * Renders the full 1080×1920 recap card as an ImageResponse (PNG stream).
 * Routes return this directly; MCP tool calls .arrayBuffer().
 */
export function renderRecapCard(recap: WeeklyRecap, template: RecapTemplate): ImageResponse {
  return new ImageResponse(
    React.createElement(RecapCard, { recap, template }),
    IMAGE_OPTIONS,
  );
}

/**
 * Renders a single 1080×1920 story slide as an ImageResponse (PNG stream).
 */
export function renderRecapStorySlide(
  recap: WeeklyRecap,
  template: RecapTemplate,
  slide: RecapSlide,
): ImageResponse {
  return new ImageResponse(
    React.createElement(RecapStorySlide, { recap, template, slide }),
    IMAGE_OPTIONS,
  );
}

// Web Worker for the Apple Health import (G2 / REQ-005).
// Receives the File, unzips when needed (fflate streaming Unzip), streams the
// XML through the pure aggregator, and posts progress + the final summary.
// The raw export never leaves this worker — only the aggregated ImportSummary
// crosses back to the form, and only daily rows ever cross the network.

import { Unzip, UnzipInflate } from "fflate";
import { createHealthAggregator, type WorkerOutMsg } from "./apple-health";

type WorkerInMsg = { type: "parse"; file: File };

const ctx = self as unknown as {
  postMessage(msg: WorkerOutMsg): void;
  onmessage: ((e: MessageEvent<WorkerInMsg>) => void) | null;
};

const PROGRESS_EVERY_BYTES = 2 * 1024 * 1024;

function post(msg: WorkerOutMsg): void {
  ctx.postMessage(msg);
}

async function isZip(file: File): Promise<boolean> {
  if (/\.zip$/i.test(file.name)) return true;
  const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  return head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04;
}

async function parseFile(file: File): Promise<void> {
  const agg = createHealthAggregator();
  const decoder = new TextDecoder("utf-8");
  let bytesRead = 0;
  let lastProgressAt = 0;

  const reportProgress = () => {
    if (bytesRead - lastProgressAt >= PROGRESS_EVERY_BYTES) {
      lastProgressAt = bytesRead;
      post({
        type: "progress",
        pct: file.size > 0 ? Math.min(99, Math.round((bytesRead / file.size) * 100)) : 0,
        recordsSeen: agg.recordsSeen(),
      });
    }
  };

  const zip = await isZip(file);
  const reader = file.stream().getReader();

  if (zip) {
    const unzip = new Unzip((entry) => {
      // The export lives at apple_health_export/export.xml; export_cda.xml is
      // a different (clinical) document and is explicitly ignored. A zip with
      // no matching entry simply feeds the aggregator nothing — the form's
      // zero-days preview shows the "is this the right file?" message.
      if (!entry.name.endsWith("export.xml") || entry.name.endsWith("export_cda.xml")) return;
      entry.ondata = (err, data, final) => {
        if (err) throw err;
        if (data) agg.pushChunk(decoder.decode(data, { stream: !final }));
      };
      entry.start();
    });
    unzip.register(UnzipInflate);

    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        unzip.push(new Uint8Array(0), true);
        break;
      }
      bytesRead += value.byteLength;
      unzip.push(value, false);
      reportProgress();
    }
  } else {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        const tail = decoder.decode();
        if (tail) agg.pushChunk(tail);
        break;
      }
      bytesRead += value.byteLength;
      agg.pushChunk(decoder.decode(value, { stream: true }));
      reportProgress();
    }
  }

  post({ type: "done", summary: agg.finish() });
}

ctx.onmessage = (e: MessageEvent<WorkerInMsg>) => {
  if (e.data?.type !== "parse") return;
  parseFile(e.data.file).catch((err) => {
    post({ type: "error", message: err instanceof Error ? err.message : String(err) });
  });
};

export {};

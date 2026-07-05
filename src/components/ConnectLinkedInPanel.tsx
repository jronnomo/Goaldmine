/**
 * ConnectLinkedInPanel — static informational server component.
 *
 * Documents the third-party linkedin-mcp-server (Claude Desktop only, stdio
 * MCP server that scrapes with the user's own LinkedIn session). Goaldmine
 * never connects to LinkedIn — this panel is pure UI copy + one external
 * link; no props, no DB, no "use client".
 *
 * Modeled on ConnectClaudePanel's settings-variant shell
 * (ConnectClaudePanel.tsx:190-194) — this component has no variant of its
 * own, it's always that hand-rolled card shell.
 */

const RELEASES_URL = "https://github.com/stickerdaniel/linkedin-mcp-server/releases";

export function ConnectLinkedInPanel() {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--background)] overflow-hidden shadow-sm p-4">
      <div className="space-y-4">
        {/* Heading */}
        <div>
          <h2 className="text-base font-semibold text-[var(--foreground)]">
            LinkedIn coaching tools (optional)
          </h2>
          <p className="mt-1 text-sm text-[var(--muted)] leading-relaxed">
            Third-party · Claude Desktop only — Goaldmine never connects to LinkedIn.
          </p>
        </div>

        {/* Always-visible warning callout — NOT inside <details> */}
        <div
          role="note"
          aria-label="LinkedIn terms-of-service warning"
          className="border-l-2 pl-3 py-2 rounded-r-lg bg-[var(--warning)]/10"
          style={{ borderLeftColor: "var(--warning)" }}
        >
          <p className="text-sm text-[var(--foreground)] leading-relaxed">
            <span aria-hidden="true">⚠ </span>
            LinkedIn&rsquo;s terms prohibit automated access. Using this can
            restrict or ban your account. Entirely at your own risk.
          </p>
        </div>

        {/* Collapsed setup steps */}
        <details className="group">
          <summary className="cursor-pointer list-none min-h-[44px] flex items-center text-sm text-[var(--muted)] hover:text-[var(--foreground)] transition-colors select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]">
            <span className="underline underline-offset-2">Setup steps (Claude Desktop)</span>
          </summary>
          <div className="mt-3 space-y-3">
            <ol className="space-y-3 text-sm">
              <li className="flex gap-3">
                <span className="flex-shrink-0 w-5 h-5 rounded-full bg-[var(--accent)]/15 text-[var(--accent)] text-xs flex items-center justify-center font-semibold">
                  1
                </span>
                <span className="text-[var(--foreground)] leading-snug">
                  Install Claude Desktop.
                </span>
              </li>
              <li className="flex gap-3">
                <span className="flex-shrink-0 w-5 h-5 rounded-full bg-[var(--accent)]/15 text-[var(--accent)] text-xs flex items-center justify-center font-semibold">
                  2
                </span>
                <span className="text-[var(--foreground)] leading-snug break-words">
                  Download the <code className="text-xs">.mcpb</code> bundle from the{" "}
                  <a
                    href={RELEASES_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-block py-2 -my-2 underline underline-offset-2 text-[var(--accent)] break-words"
                  >
                    linkedin-mcp-server GitHub releases page
                  </a>
                  .
                </span>
              </li>
              <li className="flex gap-3">
                <span className="flex-shrink-0 w-5 h-5 rounded-full bg-[var(--accent)]/15 text-[var(--accent)] text-xs flex items-center justify-center font-semibold">
                  3
                </span>
                <span className="text-[var(--foreground)] leading-snug">
                  Double-click to install.
                </span>
              </li>
              <li className="flex gap-3">
                <span className="flex-shrink-0 w-5 h-5 rounded-full bg-[var(--accent)]/15 text-[var(--accent)] text-xs flex items-center justify-center font-semibold">
                  4
                </span>
                <span className="text-[var(--foreground)] leading-snug">
                  Sign in with your own LinkedIn session (stays on your machine).
                </span>
              </li>
              <li className="flex gap-3">
                <span className="flex-shrink-0 w-5 h-5 rounded-full bg-[var(--accent)]/15 text-[var(--accent)] text-xs flex items-center justify-center font-semibold">
                  5
                </span>
                <span className="text-[var(--foreground)] leading-snug">
                  New Desktop chat → confirm the LinkedIn tools appear alongside Goaldmine.
                </span>
              </li>
            </ol>
          </div>
        </details>

        {/* Footnote — doc reference is code-styled text, not a route link (no /docs/ route exists) */}
        <p className="text-xs text-[var(--muted)] leading-relaxed break-words">
          Works only in Claude Desktop. On web/mobile your coach will ask for
          your numbers instead. Full guide &amp; warnings:{" "}
          <code className="text-xs break-words">docs/linkedin-mcp-setup.md</code>.
        </p>
      </div>
    </div>
  );
}

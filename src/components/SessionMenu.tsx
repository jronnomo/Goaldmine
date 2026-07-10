"use client";

import { useEffect, useId, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { signOutAction } from "@/lib/auth/auth-actions";

interface SessionMenuProps {
  user: {
    name?: string | null;
    email?: string | null;
    image?: string | null;
  } | null;
}

/** Extract up to 2 uppercase initials from a display name or email. */
function initials(name?: string | null, email?: string | null): string {
  const src = name ?? email ?? "";
  const parts = src.split(/[\s@._-]+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]![0]!.toUpperCase();
  return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
}

/**
 * Avatar — keyed off `src` by the caller (see `key={user.image ?? "none"}`
 * below) so a `router.refresh()`-delivered avatar URL change (e.g.
 * CheckConnectionButton on /settings) remounts this component and resets
 * `imgError` to false, instead of latching a stale broken-image state
 * forever. Falls back to the initials span (unchanged markup) on error.
 */
function Avatar({ src, alt, abbrev }: { src: string | null | undefined; alt: string; abbrev: string }) {
  const [imgError, setImgError] = useState(false);
  return src && !imgError ? (
    <Image
      src={src}
      alt={alt}
      width={44}
      height={44}
      className="w-full h-full object-cover"
      unoptimized
      onError={() => setImgError(true)}
    />
  ) : (
    <span aria-hidden className="leading-none select-none">
      {abbrev}
    </span>
  );
}

export function SessionMenu({ user }: SessionMenuProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const firstItemRef = useRef<HTMLAnchorElement>(null);
  const menuId = useId();

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open]);

  // Focus management (#240): menu open moves focus to the first item; any
  // close path returns it to the trigger. The cleanup guard covers two
  // cases: (a) focus has fallen to <body> because the focused menuitem was
  // unmounted in the same commit that closed the menu — Escape and item-
  // activation both close the menu and unmount [role="menu"] before this
  // cleanup runs, so the browser drops focus to body first; refocus the
  // trigger. (b) focus is on a real outside element the user clicked into
  // (native focus-on-mousedown runs before this cleanup) — leave it alone,
  // otherwise the mousedown outside-close would yank focus off an element
  // the user just clicked into. Note: this also depends on the app router's
  // own navigation-time focus call being a no-op (it targets the new route
  // segment's root element, which is a plain, non-focusable <div> today) —
  // if a future page root becomes focusable, revisit this ordering
  // assumption.
  useEffect(() => {
    if (!open) return;
    firstItemRef.current?.focus();
    // Snapshot the DOM nodes now — by the time cleanup runs, the refs
    // themselves could point elsewhere (react-hooks/exhaustive-deps).
    const container = containerRef.current;
    const trigger = triggerRef.current;
    return () => {
      const ae = document.activeElement;
      if (ae === document.body || container?.contains(ae)) {
        trigger?.focus();
      }
    };
  }, [open]);

  if (!user) {
    return (
      <Link
        href="/signin"
        className="ml-auto inline-flex items-center justify-center h-9 px-3 rounded-full border border-[var(--border)] text-sm font-medium text-[var(--foreground)] hover:border-[var(--accent)] transition-colors"
      >
        Sign in
      </Link>
    );
  }

  const abbrev = initials(user.name, user.email);

  return (
    <div ref={containerRef} className="ml-auto relative flex items-center">
      {/* Avatar button */}
      <button
        ref={triggerRef}
        type="button"
        aria-label="Account menu"
        aria-expanded={open}
        aria-haspopup="menu"
        aria-controls={menuId}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center justify-center w-11 h-11 rounded-full border border-[var(--border)] overflow-hidden text-sm font-semibold text-[var(--foreground)] bg-[var(--accent)]/20 hover:border-[var(--accent)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
      >
        <Avatar key={user.image ?? "none"} src={user.image} alt={user.name ?? "Avatar"} abbrev={abbrev} />
      </button>

      {/* Popover */}
      {open && (
        <div
          id={menuId}
          role="menu"
          // role="menu" without roving-tabindex/arrow-key nav is a known
          // partial APG implementation — acceptable for this 2-item menu
          // (Settings, Sign out); both items sit in the natural Tab order
          // instead of a roving tabindex. See #240.
          className="absolute right-0 top-full mt-2 w-56 rounded-xl border border-[var(--border)] bg-[var(--background)] shadow-lg z-50 py-2"
          style={{ boxShadow: "0 4px 24px 0 rgba(0,0,0,0.12)" }}
        >
          {/* User info */}
          <div className="px-4 py-2 border-b border-[var(--border)]">
            {user.name && (
              <p className="text-sm font-medium text-[var(--foreground)] truncate">
                {user.name}
              </p>
            )}
            {user.email && (
              <p className="text-xs text-[var(--muted)] truncate mt-0.5">
                {user.email}
              </p>
            )}
          </div>

          {/* Settings + Sign out */}
          <div className="px-2 pt-1 space-y-0.5">
            <Link
              ref={firstItemRef}
              href="/settings"
              role="menuitem"
              onClick={() => setOpen(false)}
              className="flex w-full items-center px-3 py-2 rounded-lg text-sm text-[var(--foreground)] hover:bg-[var(--accent)]/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
            >
              Settings
            </Link>
            <form action={signOutAction}>
              <button
                type="submit"
                role="menuitem"
                className="w-full text-left px-3 py-2 rounded-lg text-sm text-[var(--foreground)] hover:bg-[var(--accent)]/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

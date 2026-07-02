"use client";

import { useEffect, useRef, useState } from "react";
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

export function SessionMenu({ user }: SessionMenuProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

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
        type="button"
        aria-label="Account menu"
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center justify-center w-9 h-9 rounded-full border border-[var(--border)] overflow-hidden text-sm font-semibold text-[var(--foreground)] bg-[var(--accent)]/20 hover:border-[var(--accent)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
      >
        {user.image ? (
          <Image
            src={user.image}
            alt={user.name ?? "Avatar"}
            width={36}
            height={36}
            className="w-full h-full object-cover"
            unoptimized
          />
        ) : (
          <span aria-hidden className="leading-none select-none">
            {abbrev}
          </span>
        )}
      </button>

      {/* Popover */}
      {open && (
        <div
          role="menu"
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

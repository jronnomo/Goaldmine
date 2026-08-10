// Client-safe constant — the window CustomEvent that asks BottomNav to open
// its Log sheet. Fired by page-level one-tap log affordances (FuelRail's
// "Log meal" button, today-page-ia); BottomNav owns the only listener. This
// REUSES the existing sheet + LogLauncher (which now defaults its expanded
// row to "meal"), rather than rebuilding a composer anywhere else.
//
// Contract note: keep dispatcher and listener shipped together — an event
// nobody listens for is the retired AssayCeremonyController mistake.

export const OPEN_LOG_SHEET_EVENT = "goaldmine:open-log-sheet";

import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, DM_Serif_Display } from "next/font/google";
import { AppHeader } from "@/components/AppHeader";
import { BottomNav } from "@/components/BottomNav";
import { auth } from "@/lib/auth/auth";
import { getDb } from "@/lib/db";
import { startOfDay, endOfDay, resolveDay } from "@/lib/calendar";
import { getQuickPickFoods, listLibraryFoods } from "@/lib/food-actions";
import { type NutritionItem, parseStoredItems } from "@/lib/nutrition-log-ops";
import {
  sumLoggedDayMacros,
  sumPlanTargetMacros,
  hasAnyMacros,
  type DayMacros,
} from "@/lib/nutrition-macros";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const dmSerifDisplay = DM_Serif_Display({
  variable: "--font-dm-serif-display",
  subsets: ["latin"],
  weight: "400",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Goaldmine",
  description: "Mining for goals — an honest, goal-generic tracker for any goal, in any domain.",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [{ url: "/icon-192.png", sizes: "192x192" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#0F0B07",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

/** Serializable per-meal shape threaded to the Log sheet. */
export type TodayMealLite = {
  id: string;
  mealType: string;
  items: NutritionItem[];
  notes: string | null;
  dateISO: string;
  macros: {
    calories: number | null;
    proteinG: number | null;
    carbsG: number | null;
    fatG: number | null;
    fiberG: number | null;
    sodiumMg: number | null;
  };
};

// Preserve structured fields so the global Log launcher's edit path keeps live
// recalc (a stripping map reverted items to freehand steppers — stale macros on
// size change).
function toNutritionItems(raw: unknown): NutritionItem[] {
  return parseStoredItems(raw);
}

/** Shared html/head chrome — avoids duplicating font variables + theme script. */
function Shell({
  children,
  className,
}: {
  children: React.ReactNode;
  className: string;
}) {
  return (
    <html lang="en" className={className} suppressHydrationWarning>
      <head>
        {/* Pre-paint theme application — avoids a flash when the user has
            chosen a non-system theme. Mirrors STORAGE_KEY in ThemeToggle. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{var t=localStorage.getItem('goaldmine.theme');if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t)}catch(_){}",
          }}
        />
      </head>
      <body className="min-h-full flex flex-col bg-background text-foreground">
        {children}
      </body>
    </html>
  );
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const htmlClass = `${geistSans.variable} ${geistMono.variable} ${dmSerifDisplay.variable} h-full antialiased`;

  // auth() may throw in non-HTTP contexts (e.g. static prerender with UntrustedHost).
  // Treat any auth error as "no session" so public pages (/signin, /request-access)
  // prerender cleanly and never embed a NEXT_REDIRECT in their static output.
  let session: {
    user?: { id?: string; name?: string | null; email?: string | null; image?: string | null };
  } | null = null;
  try {
    session = await auth();
  } catch {
    session = null;
  }

  // Guard: skip the 4 getDb()-backed fetches when signed out.
  // Post-flip, getCurrentUserId() throws NEXT_REDIRECT for unauthenticated calls;
  // without this guard, visiting /signin (which runs this layout) would loop
  // back to /signin indefinitely. Signed-out → global chrome + children, no BottomNav.
  if (!session) {
    return (
      <Shell className={htmlClass}>
        <AppHeader user={null} />
        <main className="flex-1 pb-20">{children}</main>
      </Shell>
    );
  }

  // Signed-in path — identical fetches + render as before the A-2 flip.
  const db = await getDb();
  const now = new Date();
  const [rawMeals, quickPickFoods, libraryFoods, today] = await Promise.all([
    db.nutritionLog.findMany({
      where: { date: { gte: startOfDay(now), lte: endOfDay(now) } },
      orderBy: { date: "asc" },
      select: {
        id: true,
        date: true,
        mealType: true,
        items: true,
        notes: true,
        calories: true,
        proteinG: true,
        carbsG: true,
        fatG: true,
        fiberG: true,
        sodiumMg: true,
      },
    }),
    getQuickPickFoods(),
    listLibraryFoods(),
    // Override-aware resolved day — the only source of today's per-slot
    // nutrition-plan target. Mirrors /nutrition/page.tsx exactly.
    resolveDay(now),
  ]);

  const todaysMeals: TodayMealLite[] = rawMeals.map((m) => ({
    id: m.id,
    mealType: m.mealType,
    items: toNutritionItems(m.items),
    notes: m.notes,
    dateISO: m.date.toISOString(),
    macros: {
      calories: m.calories,
      proteinG: m.proteinG,
      carbsG: m.carbsG,
      fatG: m.fatG,
      fiberG: m.fiberG,
      sodiumMg: m.sodiumMg,
    },
  }));

  // Day context for the Log-sheet meal composer (Browse-library + build-vs-today
  // header). Same override-aware logic as /nutrition/page.tsx.
  const trackedTodayMacros: DayMacros = sumLoggedDayMacros(
    todaysMeals.map((m) => m.macros),
  );
  const planTarget = sumPlanTargetMacros(today.nutritionPlan);
  const dayTargetMacros: DayMacros | null = hasAnyMacros(planTarget)
    ? planTarget
    : null;

  return (
    <Shell className={htmlClass}>
      <AppHeader user={session?.user ?? null} />
      <main className="flex-1 pb-20">{children}</main>
      <BottomNav
        todaysMeals={todaysMeals}
        quickPickFoods={quickPickFoods}
        libraryFoods={libraryFoods}
        trackedSoFar={trackedTodayMacros}
        dayTarget={dayTargetMacros}
      />
    </Shell>
  );
}

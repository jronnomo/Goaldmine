import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, DM_Serif_Display } from "next/font/google";
import { AppHeader } from "@/components/AppHeader";
import { BottomNav } from "@/components/BottomNav";
import { prisma } from "@/lib/db";
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
  description: "Mining for goals — 90-day Mt. Elbert prep, shred, and longevity tracker.",
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

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const now = new Date();
  const [rawMeals, quickPickFoods, libraryFoods, today] = await Promise.all([
    prisma.nutritionLog.findMany({
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
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${dmSerifDisplay.variable} h-full antialiased`}
    >
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
        <AppHeader />
        <main className="flex-1 pb-20">{children}</main>
        <BottomNav
          todaysMeals={todaysMeals}
          quickPickFoods={quickPickFoods}
          libraryFoods={libraryFoods}
          trackedSoFar={trackedTodayMacros}
          dayTarget={dayTargetMacros}
        />
      </body>
    </html>
  );
}

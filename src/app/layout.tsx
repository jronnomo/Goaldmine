import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, DM_Serif_Display } from "next/font/google";
import { AppHeader } from "@/components/AppHeader";
import { BottomNav } from "@/components/BottomNav";
import { auth } from "@/lib/auth/auth";
import { getGoalCount } from "@/lib/goal-count";
import { getLogSheetData } from "@/lib/log-sheet-data";
import "./globals.css";

export type { TodayMealLite } from "@/lib/log-sheet-data";

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
  const logSheet = await getLogSheetData();
  // Standalone statement (not folded into getLogSheetData above) — keeps
  // #230's diff to pure additions so #233 (N2 layout-fetch-deferral, slated to
  // gut the 4-item meal array) can delete around it without touching this line.
  const goalCount = await getGoalCount();

  return (
    <Shell className={htmlClass}>
      <AppHeader user={session?.user ?? null} />
      <main className="flex-1 pb-20">{children}</main>
      <BottomNav
        todaysMeals={logSheet.todaysMeals}
        quickPickFoods={logSheet.quickPickFoods}
        libraryFoods={logSheet.libraryFoods}
        trackedSoFar={logSheet.trackedSoFar}
        dayTarget={logSheet.dayTarget}
        goalCount={goalCount}
      />
    </Shell>
  );
}

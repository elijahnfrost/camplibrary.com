import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { isClerkPublicKeyUsable } from "@/lib/auth";
import { ClerkAuthProvider } from "@/components/ClerkAuthProvider";
import "./globals.css";
import "./calendar.css";

// The design's faces are SELF-HOSTED (next/font/local, woff2 in ./fonts) rather
// than fetched via next/font/google. next/font/google needs a build-time network
// fetch to inject the real @font-face rules; when that fetch can't reach Google
// (offline / sandboxed dev) it silently emits ONLY the Arial metric-fallback
// faces, so every surface renders in default Arial. Bundling the woff2 makes the
// real faces load deterministically in dev, CI, and prod. Caveat + Nunito
// are variable woff2 (one file each, a 400–700 weight range); Patrick Hand and
// its small-caps are static 400.
const caveat = localFont({
  src: "./fonts/caveat-400.woff2",
  variable: "--font-script",
  weight: "400 700",
  display: "swap",
});
const patrickHand = localFont({
  src: "./fonts/patrick-hand-400.woff2",
  variable: "--font-hand",
  weight: "400",
  display: "swap",
});
const patrickHandSc = localFont({
  src: "./fonts/patrick-hand-sc-400.woff2",
  variable: "--font-hand-sc",
  weight: "400",
  display: "swap",
});
// A quiet humanist companion for body copy and dense data (catalog meta,
// schedule times, blurbs) so the densest text stays legible while the
// handwriting faces keep their personality on display headings/labels.
// Nunito (not Nunito Sans) — its rounded terminals echo Patrick Hand/Caveat's
// warmth while keeping the same legibility/hinting the plain sans needed.
const nunito = localFont({
  src: "./fonts/nunito-400.woff2",
  variable: "--font-text",
  weight: "400 700",
  display: "swap",
});

const SITE_NAME = "Camp Library";
const DESCRIPTION =
  "A warm, hand-drawn catalog of camp games, crafts, and songs — browse by shelf, deck, or card, rate what works, and plan a day.";

export const metadata: Metadata = {
  title: {
    default: "Camp Library — games, crafts & songs for camp",
    template: "%s · Camp Library",
  },
  description: DESCRIPTION,
  applicationName: SITE_NAME,
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: SITE_NAME,
    statusBarStyle: "default",
  },
  icons: {
    icon: [{ url: "/favicon.svg", type: "image/svg+xml", sizes: "any" }],
    shortcut: ["/favicon.svg"],
    apple: [{ url: "/favicon.svg", type: "image/svg+xml" }],
  },
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    title: "Camp Library",
    description: DESCRIPTION,
  },
  twitter: {
    card: "summary",
    title: "Camp Library",
    description: DESCRIPTION,
  },
};

export const viewport: Viewport = {
  themeColor: "#e9dec6",
  width: "device-width",
  initialScale: 1,
  // Lets the app sit edge-to-edge on phones with notches/home bars.
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const app = isClerkPublicKeyUsable() ? (
    <ClerkAuthProvider>{children}</ClerkAuthProvider>
  ) : (
    children
  );

  return (
    <html
      lang="en"
      className={`${caveat.variable} ${patrickHand.variable} ${patrickHandSc.variable} ${nunito.variable}`}
    >
      <body>{app}</body>
    </html>
  );
}

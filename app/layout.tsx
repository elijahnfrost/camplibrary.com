import type { Metadata, Viewport } from "next";
import { Caveat, Nunito_Sans, Patrick_Hand, Patrick_Hand_SC } from "next/font/google";
import { isClerkPublicKeyUsable } from "@/lib/auth";
import { ClerkAuthProvider } from "@/components/ClerkAuthProvider";
import "./globals.css";
import "./calendar.css";

// The design's three handwriting faces, loaded as CSS variables.
const caveat = Caveat({
  subsets: ["latin"],
  variable: "--font-script",
  display: "swap",
});
const patrickHand = Patrick_Hand({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-hand",
  display: "swap",
});
const patrickHandSc = Patrick_Hand_SC({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-hand-sc",
  display: "swap",
});
// A quiet humanist companion for body copy and dense data (catalog meta,
// schedule times, blurbs) so the densest text stays legible while the
// handwriting faces keep their personality on display headings/labels.
const nunitoSans = Nunito_Sans({
  subsets: ["latin"],
  weight: ["400", "600", "700"],
  variable: "--font-text",
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
      className={`${caveat.variable} ${patrickHand.variable} ${patrickHandSc.variable} ${nunitoSans.variable}`}
    >
      <body>{app}</body>
    </html>
  );
}

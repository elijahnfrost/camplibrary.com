import type { Metadata, Viewport } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { Caveat, Patrick_Hand, Patrick_Hand_SC } from "next/font/google";
import "./globals.css";

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
    icon: [{ url: "/icon.svg", type: "image/svg+xml", sizes: "any" }],
    shortcut: ["/icon.svg"],
    apple: [{ url: "/icon.svg", type: "image/svg+xml" }],
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
  themeColor: "#f3ecdd",
  width: "device-width",
  initialScale: 1,
  // Lets the app sit edge-to-edge on phones with notches/home bars.
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${caveat.variable} ${patrickHand.variable} ${patrickHandSc.variable}`}
    >
      <body>
        <ClerkProvider
          signInUrl="/sign-in"
          signUpUrl="/sign-up"
          signInFallbackRedirectUrl="/"
          signUpFallbackRedirectUrl="/"
        >
          {children}
        </ClerkProvider>
      </body>
    </html>
  );
}

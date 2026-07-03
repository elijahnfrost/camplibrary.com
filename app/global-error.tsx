"use client";

// Last-resort boundary (GAP-1): only rendered when the ROOT layout itself
// throws (a font/provider crash above app/error.tsx's reach). Next.js requires
// this file to render its own <html>/<body> since the real root layout is what
// crashed — its CSS imports and class vocabulary (globals.css, --paper/--ink
// tokens) can't be trusted to be present, so this stays deliberately
// self-contained with inline styles rather than reaching for app classes. Kept
// minimal on purpose: this is the fallback for when everything else fell over.
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body
        style={{
          minHeight: "100dvh",
          margin: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "1rem",
          padding: "2rem 1.25rem",
          background: "#f4ecd8",
          color: "#2b2620",
          fontFamily:
            "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
          textAlign: "center",
        }}
      >
        <span style={{ fontSize: "0.75rem", letterSpacing: "0.1em", textTransform: "uppercase", opacity: 0.7 }}>
          Camp Library
        </span>
        <h1 style={{ fontSize: "1.5rem", margin: 0 }}>Something went wrong</h1>
        <p style={{ maxWidth: "28rem", margin: 0, opacity: 0.85 }}>
          The app hit an unexpected error and couldn&apos;t load. Trying again usually clears it.
        </p>
        <div style={{ display: "flex", gap: "0.75rem" }}>
          <button
            type="button"
            onClick={reset}
            style={{
              padding: "0.6rem 1.1rem",
              borderRadius: "999px",
              border: "1px solid #2b2620",
              background: "#2b2620",
              color: "#f4ecd8",
              cursor: "pointer",
              font: "inherit",
            }}
          >
            Try again
          </button>
          <a
            href="/"
            style={{
              padding: "0.6rem 1.1rem",
              borderRadius: "999px",
              border: "1px solid #2b2620",
              background: "transparent",
              color: "#2b2620",
              textDecoration: "none",
            }}
          >
            Back to Camp Library
          </a>
        </div>
      </body>
    </html>
  );
}

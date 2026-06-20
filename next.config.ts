import type { NextConfig } from "next";

// The original Claude Design bundle lives in /project as reference material.
// It is never imported by the app (excluded in tsconfig) and is ignored by Next.
const nextConfig: NextConfig = {
  allowedDevOrigins: ["localhost", "127.0.0.1"],
  turbopack: {
    // pagedjs's package "exports" only maps the bare entry to its untranspiled
    // `src`, which trips the bundler at runtime ("contains.call is not a
    // function"). Point the import at the prebuilt ESM bundle (deps inlined +
    // transpiled) via a relative path, which bypasses the exports map. Only the
    // client (Print tab) imports it, and lazily.
    resolveAlias: {
      pagedjs: "./node_modules/pagedjs/dist/paged.esm.js",
    },
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Content-Security-Policy", value: "base-uri 'self'; object-src 'none'; frame-ancestors 'self'" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;

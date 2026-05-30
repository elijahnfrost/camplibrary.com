import type { NextConfig } from "next";

// The original Claude Design bundle lives in /project as reference material.
// It is never imported by the app (excluded in tsconfig) and is ignored by Next.
const nextConfig: NextConfig = {
  allowedDevOrigins: ["localhost", "127.0.0.1"],
};

export default nextConfig;

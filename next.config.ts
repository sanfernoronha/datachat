import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // ── API body size limit ────────────────────────────────────────────────────
  // Next.js defaults to 4 MB for API route bodies. We increase this to allow
  // CSV/XLSX uploads up to 100 MB. Actual enforcement is done in the upload
  // route (MAX_UPLOAD_SIZE_BYTES env var) with a friendlier error message.
  experimental: {
    serverActions: {
      bodySizeLimit: "100mb",
    },
  },
};

export default nextConfig;

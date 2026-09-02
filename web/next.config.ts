import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The native build's lockfile still sits one level up; without this, Turbopack
  // infers that directory as the workspace root.
  turbopack: { root: __dirname },
  // The school's iCal feed sets no CORS headers, so it is always fetched
  // server-side. Nothing here needs to reach it from the browser.
};

export default nextConfig;

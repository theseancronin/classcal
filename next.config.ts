import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The school's iCal feed sets no CORS headers, so it is always fetched
  // server-side. Nothing here needs to reach it from the browser.
};

export default nextConfig;

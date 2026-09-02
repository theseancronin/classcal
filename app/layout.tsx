import type { Metadata, Viewport } from 'next';

import { DEFAULT_SCHOOL } from '@/config/school';
import { AppProvider } from '@/state/AppProvider';
import './globals.css';

export const metadata: Metadata = {
  title: 'ClassCal',
  description: `School calendar for ${DEFAULT_SCHOOL.name}, filtered to your children's classes.`,
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    title: 'ClassCal',
    statusBarStyle: 'default',
  },
};

export const viewport: Viewport = {
  themeColor: '#FBF9F6',
  width: 'device-width',
  initialScale: 1,
  // Never block zoom: pinch-to-zoom is an accessibility requirement.
  maximumScale: 5,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IE">
      <body>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:m-2 focus:rounded-md focus:bg-accent focus:px-4 focus:py-3 focus:text-on-accent"
        >
          Skip to content
        </a>
        <AppProvider>{children}</AppProvider>
      </body>
    </html>
  );
}

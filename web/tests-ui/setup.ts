/**
 * Screen-test environment.
 *
 * The screens are exercised as a parent would meet them: real components, real
 * state, real localStorage. Only two things are stubbed — the network, because
 * these tests assert on what the UI does with a payload rather than on the
 * server, and Next's router, which needs an app runtime that jsdom has not got.
 */
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';

export const mockRouter = {
  push: vi.fn(),
  replace: vi.fn(),
  back: vi.fn(),
  forward: vi.fn(),
  refresh: vi.fn(),
  prefetch: vi.fn(),
};

export const mockParams: { current: Record<string, string> } = { current: {} };

vi.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
  useParams: () => mockParams.current,
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/',
}));

// next/link renders an anchor in tests; the real one needs the app router.
vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
  } & Record<string, unknown>) => {
    const React = require('react');
    return React.createElement('a', { href, ...rest }, children);
  },
}));

beforeEach(() => {
  window.localStorage.clear();
  mockRouter.push.mockClear();
  mockRouter.replace.mockClear();
  mockParams.current = {};
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

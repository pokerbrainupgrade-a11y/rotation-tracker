import { TABS, type TabId } from '../types';

export type Route = TabId | 'settings' | 'setup' | 'session' | 'maxes';

const VALID: Route[] = [...TABS.map((t) => t.id), 'settings', 'setup', 'session', 'maxes'];

export const DEFAULT_ROUTE: Route = 'dashboard';

export function parseHash(hash: string): Route {
  const raw = hash.replace(/^#\/?/, '').split('?')[0] ?? '';
  return (VALID as string[]).includes(raw) ? (raw as Route) : DEFAULT_ROUTE;
}

export function hashFor(route: Route): string {
  return `#/${route}`;
}

/**
 * Dashboard is the landing route on EVERY launch — a deep tab is never
 * restored across launches. Within a session, back/forward still work, which
 * is what hash routing buys in a standalone PWA where there is no URL bar to
 * fall back on.
 */
export function initialRoute(): Route {
  return DEFAULT_ROUTE;
}

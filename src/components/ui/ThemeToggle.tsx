'use client';

import { useSyncExternalStore, useCallback } from 'react';

const STORAGE_KEY = 'ow-theme';

/**
 * Inline script that applies the stored theme before first paint.
 *
 * Must run synchronously in <head> — running it in an effect would let the
 * light default paint first and flash on every load for dark-mode users.
 */
export const themeInitScript = `
(function() {
  try {
    var stored = localStorage.getItem('${STORAGE_KEY}');
    var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (stored === 'dark' || (!stored && prefersDark)) {
      document.documentElement.classList.add('dark');
    }
  } catch (e) {
    /* localStorage unavailable (private mode); fall back to light. */
  }
})();
`;

/* -------------------------------------------------------------------------- */
/* External store over the <html> class list                                   */
/* -------------------------------------------------------------------------- */
/**
 * The theme's source of truth is a DOM class set by `themeInitScript`, outside
 * React. `useSyncExternalStore` is the correct way to read it: it avoids the
 * setState-in-effect cascade and returns the correct value during SSR.
 */

const themeListeners = new Set<() => void>();

function subscribe(onStoreChange: () => void) {
  themeListeners.add(onStoreChange);
  return () => {
    themeListeners.delete(onStoreChange);
  };
}

function notifyThemeChanged() {
  for (const listener of themeListeners) listener();
}

function getSnapshot(): boolean {
  return document.documentElement.classList.contains('dark');
}

/**
 * Server snapshot. The real value is unknowable during SSR — it lives in the
 * visitor's localStorage — so the button renders its light-mode icon and the
 * client corrects it on hydration.
 */
function getServerSnapshot(): boolean {
  return false;
}

export function ThemeToggle() {
  const isDark = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const toggle = useCallback(() => {
    const next = !document.documentElement.classList.contains('dark');
    document.documentElement.classList.toggle('dark', next);
    try {
      localStorage.setItem(STORAGE_KEY, next ? 'dark' : 'light');
    } catch {
      /* Preference simply won't persist. */
    }
    notifyThemeChanged();
  }, []);

  return (
    <button
      type="button"
      onClick={toggle}
      className="inline-flex items-center justify-center size-9 rounded-lg text-[var(--text-secondary)] hover:bg-[var(--surface-sunken)] hover:text-[var(--text-primary)] transition-colors"
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      title={isDark ? 'Light mode' : 'Dark mode'}
    >
      {isDark ? (
        <svg
          className="size-4"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="4" />
          <path
            d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M6.3 17.7l-1.4 1.4M19.1 4.9l-1.4 1.4"
            strokeLinecap="round"
          />
        </svg>
      ) : (
        <svg
          className="size-4"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <path
            d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </button>
  );
}

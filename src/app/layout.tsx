import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { themeInitScript } from '@/components/ui/ThemeToggle';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    default: 'Orbit Works CRM',
    template: '%s · Orbit Works CRM',
  },
  description: 'Custom CRM for Orbit Works — contacts, deals, invoices, and reporting.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <head>
        {/* Applies the stored theme before paint to prevent a light flash. */}
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-dvh bg-[var(--surface-base)] text-[var(--text-primary)]">
        {children}
      </body>
    </html>
  );
}

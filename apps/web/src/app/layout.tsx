import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'Deck generator',
  description: 'Generates a deck in the style of an uploaded template.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru">
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}

import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
import Providers from './providers';

export const metadata: Metadata = {
  title: 'Extractos Bancarios',
  description:
    'Clasificación automática de extractos bancarios para comunidades de propietarios',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <body className="min-h-screen bg-background text-neutral-200 antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

import type { ReactNode } from 'react';

export const metadata = {
  title: 'Jane Appointments API',
  description: 'Jane App integration for a Retell voice agent',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif', margin: '2rem', lineHeight: 1.5 }}>
        {children}
      </body>
    </html>
  );
}

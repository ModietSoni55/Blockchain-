import React from 'react';
import './globals.css';

export const metadata = {
  title: 'MedSupply Sentinel | Anti-Counterfeit Medicine Traceability',
  description:
    'Blockchain-based anti-counterfeit medicine traceability with QR verification, cold-chain monitoring, and AI risk detection.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="bg-slate-950 text-slate-100 antialiased min-h-screen">
        {children}
      </body>
    </html>
  );
}

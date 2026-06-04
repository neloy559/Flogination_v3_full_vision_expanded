import './globals.css';

export const metadata = {
  title: 'Flogination — Elite Session Manager',
  description: 'Elite Facebook Session Management System v5',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* Material Symbols — variable font for smooth icon rendering */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=swap"
        />
        {/* Inter + JetBrains Mono — full weight range */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap"
        />
      </head>
      <body className="bg-background text-on-surface font-sans antialiased overflow-hidden">
        {children}
      </body>
    </html>
  );
}

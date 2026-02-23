import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "learn-upstash",
  description: "Fluxo de checkout realtime para estudo",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}

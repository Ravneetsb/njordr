import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Njordr Stock Risk",
  description: "Personal local-first stock risk assessment app",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Fantasy Franchise | Build Your Dynasty",
  description:
    "Draft your team. Build your dynasty. A multiplayer football franchise simulator.",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

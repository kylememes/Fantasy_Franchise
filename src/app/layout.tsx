import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  metadataBase: new URL("https://fantasy-franchise-three.vercel.app"),
  title: "Fantasy Franchise | Build Your Dynasty",
  icons: {
    icon: "/brand/fantasy-franchise-logo.jpg",
    apple: "/brand/fantasy-franchise-logo.jpg",
  },
  openGraph: {
    title: "Fantasy Franchise | Build Your Dynasty",
    images: [
      {
        url: "/brand/fantasy-franchise-logo.jpg",
        width: 1206,
        height: 795,
        alt: "Fantasy Franchise",
      },
    ],
  },
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

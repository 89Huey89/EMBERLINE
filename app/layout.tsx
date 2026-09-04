import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const base = new URL(`${protocol}://${host}`);
  const image = new URL("/og.png", base).toString();
  return {
    metadataBase: base,
    title: "EMBERLINE — Civilian Orbital Freight",
    description: "A playable 2D browser game of Newtonian flight, physical cargo, salvage, and quiet work among the close orbits of Cinder.",
    openGraph: {
      title: "EMBERLINE — Civilian Orbital Freight",
      description: "Master momentum, move physical freight, recover salvage, and build a working life in the Cinder system.",
      images: [{ url: image, width: 1792, height: 941, alt: "EMBERLINE civilian freight ship above Cinder" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "EMBERLINE — Civilian Orbital Freight",
      description: "Mass, momentum, and the quiet satisfaction of bringing a difficult load home.",
      images: [image],
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}

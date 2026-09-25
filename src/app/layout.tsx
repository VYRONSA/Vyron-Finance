import type { Metadata } from "next";
import { Source_Serif_4, Inter, IBM_Plex_Mono, Montserrat } from "next/font/google";
import "./globals.css";

// Executive serif (the login card's "Welcome back" and legacy headings) /
// modern interface sans (body & UI) / monospaced financial figures /
// PRECISIA geometric sans (the wordmark and landing-page headlines, per
// the approved PRECISIA reference images).
const sourceSerif = Source_Serif_4({
  variable: "--font-source-serif",
  subsets: ["latin"],
  weight: ["500", "600"],
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "600"],
});

const montserrat = Montserrat({
  variable: "--font-montserrat",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "PRECISIA — Financial Intelligence",
  description:
    "PRECISIA gives you complete financial control with real-time insights, automated processing and AI-powered intelligence. A product of Vyronsoft (Pty) Ltd.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${sourceSerif.variable} ${inter.variable} ${plexMono.variable} ${montserrat.variable}`}
    >
      <body className="min-h-full font-sans antialiased">{children}</body>
    </html>
  );
}

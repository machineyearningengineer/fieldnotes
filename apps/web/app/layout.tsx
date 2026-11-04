import type { Metadata, Viewport } from "next";
import "@fontsource-variable/source-sans-3";
import "../ui/looseleaf/theme.css";
import "@fontsource-variable/source-serif-4";
import "@fontsource-variable/source-serif-4/wght-italic.css";
import "./globals.css";
import "./tokens.css";
import { themeBootScript } from "../lib/theme";
import { Providers } from "../components/providers";
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  interactiveWidget: "resizes-content",
};
export const metadata: Metadata = {
  title: "Fieldnotes — science, with sources",
  description: "A research notebook for discovering evidence and comparing ideas.",
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-scroll-behavior="smooth" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

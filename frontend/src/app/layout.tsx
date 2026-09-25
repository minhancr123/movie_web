import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans, Syne, Space_Grotesk, Be_Vietnam_Pro } from "next/font/google";
import "./globals.css";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import AuthProvider from "@/components/AuthProvider";
import BottomNav from "@/components/BottomNav";

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin", "vietnamese"],
  display: "swap",
  variable: "--font-jakarta",
});

const syne = Syne({
  // NOTE: Google Fonts ships Syne in latin/latin-ext/greek only — there is
  // no vietnamese subset. Vietnamese glyphs fall through to Plus Jakarta
  // Sans (see tailwind fontFamily.syne stack), which does ship vietnamese.
  subsets: ["latin"],
  display: "swap",
  variable: "--font-syne",
});

const grotesk = Space_Grotesk({
  subsets: ["latin", "vietnamese"],
  display: "swap",
  variable: "--font-grotesk",
});

// Display fallback for Vietnamese: Syne ships no vietnamese subset, so VN
// glyphs fall through to Be Vietnam Pro (geometric, designed for Vietnamese)
// instead of an anonymous system font.
const beVietnamPro = Be_Vietnam_Pro({
  subsets: ["latin", "vietnamese"],
  weight: ["700", "800", "900"],
  display: "swap",
  variable: "--font-bevn",
});

export const metadata: Metadata = {
  title: "CineVN - Xem Phim Online Chất Lượng Cao",
  description: "CineVN - Nền tảng xem phim trực tuyến 4K HDR, âm thanh vòm Spatial Audio và phụ đề Vietsub mượt mà.",
  manifest: "/manifest.json",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/icon.png", type: "image/png", sizes: "512x512" },
    ],
    shortcut: "/favicon.ico",
    apple: "/apple-touch-icon.png",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "CineVN",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#f59e0b",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="vi" className={`dark ${jakarta.variable} ${syne.variable} ${grotesk.variable} ${beVietnamPro.variable}`}>
      <head>
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=swap"
        />
      </head>
      <body className="bg-background text-cinema-text font-sans antialiased selection:bg-amber-primary selection:text-black">
        <AuthProvider>
          <Header />
          <main className="min-h-screen pt-20 mx-auto w-full max-w-shell px-4 md:px-8 pb-20 md:pb-12">
            {children}
          </main>
          <BottomNav />
          <Footer />
        </AuthProvider>
      </body>
    </html>
  );
}


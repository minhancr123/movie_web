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

/**
 * API origin (no trailing /api) for the preconnect hint. NEXT_PUBLIC_API_URL is
 * the same variable lib/api.ts and lib/catalog.ts resolve against, so the hint
 * can never point somewhere the app does not actually call. localhost gets no
 * hint: it is already "connected" and the link would only add noise.
 */
const apiOrigin = (() => {
  const raw = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5001/api";
  try {
    const { origin, hostname } = new URL(raw);
    if (!hostname || hostname === "localhost" || hostname === "127.0.0.1") return null;
    return origin;
  } catch {
    return null;
  }
})();

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="vi" className={`dark ${jakarta.variable} ${syne.variable} ${grotesk.variable} ${beVietnamPro.variable}`}>
      <head>
        {/* Which build is actually running, readable in View Source.
            A content-hashed chunk means the server can never serve stale code,
            so "did the deploy land, or is this tab old?" is otherwise answered by
            guessing from symptoms. RELEASE_ID is a runtime env of this container,
            and the root layout is a server component, so it is the real thing. */}
        <meta name="cinevn-release" content={process.env.RELEASE_ID || 'dev'} />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=swap"
        />
        {apiOrigin && (
          <>
            {/* The API is a different origin from the site, so the first resolve on
                a cold visit pays DNS + TCP + TLS before a byte moves — 100-300ms on
                a phone, on the critical path to the first frame. Open the socket
                while the head is parsed instead. */}
            <link rel="preconnect" href={apiOrigin} crossOrigin="anonymous" />
            <link rel="dns-prefetch" href={apiOrigin} />
          </>
        )}
      </head>
      <body className="bg-background text-cinema-text font-sans antialiased selection:bg-amber-primary selection:text-black">
        <AuthProvider>
          <Header />
          <main className="min-h-screen pt-20 mx-auto w-full max-w-shell px-4 md:px-8 pb-28 md:pb-12">
            {children}
          </main>
          <BottomNav />
          <Footer />
        </AuthProvider>
      </body>
    </html>
  );
}


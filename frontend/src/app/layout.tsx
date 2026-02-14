import type { Metadata, Viewport } from "next";
import "./globals.css";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import AuthProvider from "@/components/AuthProvider";

export const metadata: Metadata = {
  title: "Movie Web - Xem Phim Online",
  description: "Web xem phim miễn phí",
  manifest: "/manifest.json",
  themeColor: "#DC2626",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "MovieWeb",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

import BottomNav from "@/components/BottomNav";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="vi">
      <body className="bg-black text-white antialiased">
        <AuthProvider>
          <Header />
          <main className="min-h-screen pt-20 container mx-auto px-4 pb-20 md:pb-12 text-zinc-100">
            {children}
          </main>
          <BottomNav />
          <Footer />
        </AuthProvider>
      </body>
    </html>
  );
}


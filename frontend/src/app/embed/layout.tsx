export default function EmbedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="vi">
      <body className="bg-black m-0 p-0 overflow-hidden">
        {children}
      </body>
    </html>
  );
}

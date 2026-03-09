import type { Metadata } from "next";
import "@material-symbols/font-400/outlined.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "CTV Management Tool | Quản lý Team Cộng tác viên",
  description: "Công cụ quản lý team cộng tác viên tổng thể - theo dõi bài viết, KPI và nhuận bút.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="vi" suppressHydrationWarning>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}

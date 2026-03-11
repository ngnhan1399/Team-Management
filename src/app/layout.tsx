import type { Metadata } from "next";
import "@material-symbols/font-400/outlined.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Workdocker | Editorial Operations Workspace",
  description: "Workdocker là không gian vận hành nội dung giúp đội ngũ theo dõi bài viết, KPI, feedback và nhuận bút trên một giao diện thống nhất.",
  applicationName: "Workdocker",
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

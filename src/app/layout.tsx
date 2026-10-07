import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Speech Coach AI",
  description: "本地优先的 AI 演讲、路演与主持陪练工具",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}

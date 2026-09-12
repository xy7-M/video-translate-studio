import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
});
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
  weight: "100 900",
});
// Caveat 自托管（仅拉丁子集，供 >_ 前缀等英文点缀），国内网络无需访问 Google Fonts
const caveat = localFont({
  src: "./fonts/Caveat-700.woff2",
  variable: "--font-caveat",
  weight: "700",
});

export const metadata: Metadata = {
  title: "视频快译 · 英文视频自动生成双语字幕",
  description: "导入英文视频，自动转写、翻译，一键生成中英双语字幕与烧录版视频",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className={`${geistSans.variable} ${geistMono.variable} ${caveat.variable}`}>{children}</body>
    </html>
  );
}

import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Luna Arc | Private Period Tracker",
  description:
    "A local-first menstrual cycle tracker with adaptive estimated windows for regular and irregular cycles.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang='en' className='h-full antialiased'>
      <body className='min-h-full flex flex-col'>{children}</body>
    </html>
  );
}

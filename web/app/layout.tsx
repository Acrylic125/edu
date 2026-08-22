import type { Metadata } from "next"
import { Geist, Geist_Mono } from "next/font/google"

import { ThemeBootScript } from "@/components/theme/theme-boot-script"
import { ThemeProvider } from "@/components/theme/theme-provider"

import "./globals.css"

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
})

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
})

export const metadata: Metadata = {
  title: "Edu",
  description: "Chat",
}

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <ThemeBootScript />
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  )
}

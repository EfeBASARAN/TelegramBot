import type { Metadata } from 'next'
import { Plus_Jakarta_Sans } from 'next/font/google'
import LicenseGate from '@/components/LicenseGate'
import './globals.css'

const plusJakarta = Plus_Jakarta_Sans({
  subsets: ['latin', 'latin-ext'],
  variable: '--font-sans',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'EB Telegram Oto Mesaj | Çoklu hesap yönetimi',
  description:
    'Birden fazla Telegram hesabı, tekrar kullanılabilir mesaj şablonları ve zamanlanmış toplu gönderim — tek arayüzden yönetin.',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="tr" className={plusJakarta.variable}>
      <body className="font-sans antialiased">
        <LicenseGate>{children}</LicenseGate>
      </body>
    </html>
  )
}


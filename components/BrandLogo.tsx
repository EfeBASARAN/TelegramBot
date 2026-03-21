'use client'

import Image from 'next/image'
import { BRAND_NAME } from '@/lib/brand'

const sizeMap = { sm: 36, md: 44, lg: 56 } as const

type BrandLogoSize = keyof typeof sizeMap

type BrandLogoProps = {
  size?: BrandLogoSize
  className?: string
  withRing?: boolean
}

export default function BrandLogo({ size = 'md', className = '', withRing = true }: BrandLogoProps) {
  const px = sizeMap[size]
  return (
    <div
      className={`relative flex-shrink-0 rounded-2xl overflow-hidden ${withRing ? 'ring-2 ring-white/15 shadow-lg shadow-cyan-500/10' : ''} ${className}`}
      style={{ width: px, height: px }}
    >
      <Image
        src="/logo.svg"
        alt={BRAND_NAME}
        width={px}
        height={px}
        className="object-contain w-full h-full"
        priority
        unoptimized
      />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-white/10 via-transparent to-cyan-400/5 opacity-60" />
    </div>
  )
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  /** Tek klasörde çalıştırılabilir paket: `.next/standalone` + `public` kopyası (SATICI-KURULUM.txt) */
  output: 'standalone',
  experimental: {
    serverActions: true,
  },
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
        crypto: false,
      }
    }
    return config
  },
}

module.exports = nextConfig


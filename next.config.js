const WebpackObfuscator = require('webpack-obfuscator')

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  /** Tek klasörde çalıştırılabilir paket: `.next/standalone` + `public` kopyası (SATICI-KURULUM.txt) */
  output: 'standalone',
  webpack: (config, { dev, isServer }) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
        crypto: false,
      }
    }
    /** Üretimde istemci paketlerini obfuscate et (dosya düzenleyerek bypass zorlaşır; %100 şifre değildir). */
    if (!dev && !isServer && process.env.NEXT_DISABLE_OBFUSCATION !== '1') {
      config.plugins.push(
        new WebpackObfuscator(
          {
            compact: true,
            rotateStringArray: true,
            stringArray: true,
            stringArrayEncoding: ['base64'],
            stringArrayThreshold: 0.75,
            identifierNamesGenerator: 'hexadecimal',
            renameGlobals: false,
            selfDefending: false,
            controlFlowFlattening: true,
            controlFlowFlatteningThreshold: 0.2,
            deadCodeInjection: false,
            simplify: true,
            splitStrings: true,
            splitStringsChunkLength: 5,
            numbersToExpressions: true,
          },
          ['**/node_modules/**']
        )
      )
    }
    return config
  },
}

module.exports = nextConfig


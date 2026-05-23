import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: "default-src 'self'; script-src 'self' 'unsafe-eval' 'unsafe-inline'; object-src 'none'; base-uri 'self';",
          }
        ],
      },
    ];
  },
  webpack: (config, { dev, isServer }) => {
    // Only obfuscate in production and on the client-side build
    if (!dev && !isServer) {
      // Use dynamic require so it doesn't break if the package is missing during early dev stages
      try {
        const WebpackObfuscator = require('webpack-obfuscator');
        config.plugins.push(
          new WebpackObfuscator(
            {
              rotateStringArray: true,
              stringArray: true,
              stringArrayEncoding: ['base64'],
              stringArrayThreshold: 0.75,
              compact: true,
              controlFlowFlattening: true,
              controlFlowFlatteningThreshold: 0.75,
              deadCodeInjection: true,
              deadCodeInjectionThreshold: 0.4,
              debugProtection: true,
              debugProtectionInterval: 1000,
              disableConsoleOutput: true,
              identifierNamesGenerator: 'hexadecimal',
            },
            // Exclude everything except the sensitive files
            ['!(**/anti-bot.js|**/client-crypto.js)']
          )
        );
      } catch (e) {
        console.warn('webpack-obfuscator not found, skipping obfuscation');
      }
    }
    return config;
  },
};

export default nextConfig;

/** @type {import('next').NextConfig} */
const nextConfig = {
  // The Jane client uses axios/cheerio/tough-cookie (Node-only), so API routes
  // run on the Node.js runtime, not Edge. Keep these external to the bundle.
  experimental: {
    serverComponentsExternalPackages: ['cheerio', 'tough-cookie', 'axios', 'axios-cookiejar-support'],
  },
  // The source uses ESM-style `.js` import specifiers that actually point at
  // `.ts` files. Teach webpack to resolve them.
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      '.js': ['.ts', '.tsx', '.js'],
      '.mjs': ['.mts', '.mjs'],
    };
    return config;
  },
};

export default nextConfig;

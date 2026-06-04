/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // standalone output bundles a minimal Next.js server into .next/standalone/
  // This allows Electron to spawn it as a child process without needing
  // the full node_modules tree at runtime.
  output: 'standalone',
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: 'http://localhost:3001/api/:path*',
      },
    ];
  },
};

module.exports = nextConfig;

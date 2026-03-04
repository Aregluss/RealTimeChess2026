/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: [
    '@realtimechess/shared-types',
    '@realtimechess/game-engine',
    '@realtimechess/server-core'
  ]
};

export default nextConfig;

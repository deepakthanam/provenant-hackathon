import type { NextConfig } from 'next';

const config: NextConfig = {
  transpilePackages: ['@provenant/config'],
  reactStrictMode: true,
  // The demo video should show the product, not the dev overlay.
  devIndicators: false,
};

export default config;

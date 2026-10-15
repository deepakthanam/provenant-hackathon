import type { NextConfig } from 'next';

const config: NextConfig = {
  transpilePackages: ['@provenant/config'],
  reactStrictMode: true,
};

export default config;

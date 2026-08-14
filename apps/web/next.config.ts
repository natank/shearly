import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  transpilePackages: ['@shearly/ui-design-system', '@shearly/ui-i18n'],
  async rewrites() {
    return [{ source: '/api/:path*', destination: 'http://127.0.0.1:4000/api/:path*' }];
  },
};

export default withNextIntl(nextConfig);

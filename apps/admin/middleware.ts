import createMiddleware from 'next-intl/middleware';
import { routing } from '@shearly/ui-i18n';

export default createMiddleware(routing);

export const config = {
  matcher: ['/', '/(he|en)/:path*'],
};

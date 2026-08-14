import { createNavigation } from 'next-intl/navigation';
import { routing } from '@shearly/ui-i18n';

export const { Link, redirect, usePathname, useRouter } = createNavigation(routing);

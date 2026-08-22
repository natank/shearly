import type { Config } from 'tailwindcss';
// Relative on purpose: Tailwind loads this file with Node, not tsconfig paths.
import { designSystemPreset } from '../../libs/ui/design-system/tailwind.config';

const config: Config = {
  presets: [designSystemPreset],
  content: [
    './app/**/*.{ts,tsx}',
    './src/**/*.{ts,tsx}',
    '../../libs/ui/design-system/src/**/*.{ts,tsx}',
    '../../libs/ui/feature-account/src/**/*.{ts,tsx}',
    '../../libs/ui/feature-provider/src/**/*.{ts,tsx}',
    '../../libs/ui/feature-discovery/src/**/*.{ts,tsx}',
    '../../libs/ui/feature-booking/src/**/*.{ts,tsx}',
  ],
};

export default config;

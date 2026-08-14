import type { Config } from 'tailwindcss';
import { designSystemPreset } from '@shearly/ui-design-system/tailwind';

const config: Config = {
  presets: [designSystemPreset],
  content: [
    './app/**/*.{ts,tsx}',
    './src/**/*.{ts,tsx}',
    '../../libs/ui/design-system/src/**/*.{ts,tsx}',
  ],
};

export default config;

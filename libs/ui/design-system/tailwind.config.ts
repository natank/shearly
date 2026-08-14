import type { Config } from 'tailwindcss';

export const designSystemPreset: Config = {
  content: [],
  theme: {
    extend: {
      colors: {
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        accent: 'hsl(var(--accent))',
        input: 'hsl(var(--input))',
      },
      borderRadius: {
        md: 'var(--radius)',
      },
    },
  },
  plugins: [],
};

export default designSystemPreset;

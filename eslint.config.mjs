import nx from '@nx/eslint-plugin';

export default [
  ...nx.configs['flat/base'],
  ...nx.configs['flat/typescript'],
  {
    ignores: ['**/dist', '**/coverage', '**/node_modules', '**/.nx', '**/.next'],
  },
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    rules: {
      '@nx/enforce-module-boundaries': [
        'error',
        {
          enforceBuildableLibDependency: false,
          allow: [],
          depConstraints: [
            {
              sourceTag: 'type:app-web',
              onlyDependOnLibsWithTags: ['type:feature', 'type:contract', 'type:ui', 'type:shared'],
            },
            {
              sourceTag: 'type:app-api',
              onlyDependOnLibsWithTags: [
                'type:service',
                'type:contract',
                'type:domain',
                'type:shared',
              ],
            },
            {
              sourceTag: 'type:app-e2e',
              onlyDependOnLibsWithTags: ['type:contract', 'type:shared'],
            },
            {
              sourceTag: 'type:service',
              onlyDependOnLibsWithTags: ['type:contract', 'type:domain', 'type:shared'],
            },
            {
              sourceTag: 'type:contract',
              onlyDependOnLibsWithTags: ['type:contract', 'type:shared'],
            },
            {
              sourceTag: 'type:domain',
              onlyDependOnLibsWithTags: ['type:domain'],
            },
            {
              sourceTag: 'type:feature',
              onlyDependOnLibsWithTags: ['type:ui', 'type:contract', 'type:shared'],
            },
            {
              sourceTag: 'type:ui',
              onlyDependOnLibsWithTags: ['type:ui', 'type:shared'],
            },
            {
              sourceTag: 'type:shared',
              onlyDependOnLibsWithTags: ['type:shared'],
            },
          ],
        },
      ],
    },
  },
];

import nx from '@nx/eslint-plugin';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/.next-chat-e2e/**',
      '**/coverage/**',
      '**/.nx/**',
      '**/.source/**',
      '**/out/**',
      'packages/contracts/schema/**',
      'engine/**',
      'tools/**',
    ],
  },
  ...nx.configs['flat/base'],
  ...nx.configs['flat/typescript'],
  ...nx.configs['flat/javascript'],
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.mjs', '**/*.cjs'],
    rules: {
      // Layer boundaries of the TypeScript side. Tags are declared in each project.json.
      '@nx/enforce-module-boundaries': [
        'error',
        {
          enforceBuildableLibDependency: true,
          allow: [],
          depConstraints: [
            {
              sourceTag: 'scope:web',
              onlyDependOnLibsWithTags: ['scope:web', 'scope:shared'],
            },
            {
              sourceTag: 'scope:api',
              onlyDependOnLibsWithTags: ['scope:api', 'scope:shared'],
            },
            {
              sourceTag: 'scope:shared',
              onlyDependOnLibsWithTags: ['scope:shared'],
            },
            {
              sourceTag: 'scope:docs',
              onlyDependOnLibsWithTags: ['scope:docs', 'scope:shared'],
            },
            {
              sourceTag: 'type:lib',
              notDependOnLibsWithTags: ['type:app'],
            },
          ],
        },
      ],
    },
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // Иконки веб-приложения — только через реестр со смысловыми именами: смена набора или глифа
    // правит один файл, а толщина линии одна на всё приложение.
    files: ['apps/web/src/**/*.ts', 'apps/web/src/**/*.tsx'],
    ignores: ['apps/web/src/components/ui/icons.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@tabler/icons-react',
              message: 'Импортируйте иконки из @/components/ui/icons.',
            },
          ],
          patterns: [
            {
              group: ['@hugeicons/*'],
              message: 'Набор иконок — Tabler через @/components/ui/icons.',
            },
          ],
        },
      ],
    },
  },
  prettier,
];

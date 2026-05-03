// eslint.config.js (flat config)
import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';
import { globalIgnores } from 'eslint/config';

export default tseslint.config([
  // ⛔ Ignore generated/build artifacts + legacy backend
  globalIgnores([
    'node_modules',
    'dist',
    'build',
    // web bundles
    'public/assets',
    '**/public/assets',
    '**/*.min.js',
    // Android/Capacitor builds
    'android/**/assets',
    'android/**/build',
    'android/app/src/main/assets',
    'android/app/build/intermediates/assets',
    // iOS/Capacitor builds
    'ios/**/public',
    'ios/**/build',
    'ios/App/public',
    'ios/App/App/public',
    // (Optional) ignore the old backend entirely
    'Backend_Files/**',
  ]),

  {
    files: ['**/*.{ts,tsx,js,jsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs['recommended-latest'],
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.es2021,
      },
    },
    rules: {
      /* 1) Ban raw console (forces our scrubbed logger). Allow warn/error only. */
      'no-console': ['error', { allow: ['warn', 'error'] }],

      /* 2) Don’t let “password/token/etc.” exist as identifier names */
      'id-denylist': [
        'error',
        'password', 'pwd', 'pass', 'secret',
        'token', 'accessToken', 'idToken', 'refreshToken',
        'authorization', 'authHeader', 'serverAuthCode',
        'apiKey', 'apikey', 'api_key',
      ],

      /* 3) Guard against console.log/debug/info (warn/error allowed) */
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "CallExpression[callee.object.name='console'][callee.property.name=/^(log|debug|info)$/]",
          message: 'Use logger.* (scrubbed) instead of console.log/debug/info',
        },
      ],
    },
  },
]);

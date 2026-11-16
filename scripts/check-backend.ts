import { readBackendConfig } from '../src/lib/backendConfig.ts';

// Run before cloud dependency installation, so use only Node and local source.
// Ordinary local previews and development clients can still run without sharing.
const developmentBuild =
  process.argv.includes('--build') &&
  process.env.EAS_BUILD_PROFILE === 'development';

if (developmentBuild) {
  console.info('Development client: hosted sharing configuration is optional.');
} else {
  const config = readBackendConfig(
    process.env.EXPO_PUBLIC_SUPABASE_URL,
    process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
  const endpoint = config ? new URL(config.url) : null;
  if (
    !endpoint ||
    endpoint.protocol !== 'https:' ||
    ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname)
  ) {
    console.error(
      'Sharing configuration is missing or invalid. Set EXPO_PUBLIC_SUPABASE_URL ' +
        'to the hosted HTTPS project URL and EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ' +
        'to its public publishable key. Use .env.local for backend:check and the ' +
        'matching Expo environment for cloud builds. See docs/ANDROID_TESTING_SETUP.md.',
    );
    process.exitCode = 1;
  } else {
    console.info(
      `Public backend configuration is valid for ${endpoint.hostname}. ` +
        'This checks configuration format only; hosted migrations and email delivery still need verification.',
    );
  }
}

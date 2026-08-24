import {
  describeEnvironment,
  environmentWarnings,
} from '../lib/environment';

const snapshot = describeEnvironment({
  variant: process.env.APP_VARIANT,
  supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
});

console.log(
  [
    `App Variant: ${snapshot.variant}`,
    `Supabase Host: ${snapshot.supabaseHost}`,
    `Project Ref: ${snapshot.projectRef ?? '(unknown)'}`,
    `Scheme: ${snapshot.scheme}`,
    `Bundle ID: ${snapshot.bundleId}`,
    `Generated OAuth return: ${snapshot.generatedOAuthReturn}`,
    `Generated Auth callback: ${snapshot.generatedAuthCallback}`,
  ].join('\n'),
);

for (const warning of environmentWarnings({
  variant: process.env.APP_VARIANT,
  supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
})) {
  console.warn(warning);
}

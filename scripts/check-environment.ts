import {
  BOTH_STAGE_PROJECT_REF,
  LEGACY_STAGE_PROJECT_REF,
  describeEnvironment,
  environmentWarnings,
} from '../lib/environment.ts';

const snapshot = describeEnvironment({
  variant: process.env.APP_VARIANT,
  supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
});

const legacy = snapshot.projectRef === LEGACY_STAGE_PROJECT_REF ? 'YES' : 'NO';
const stage = snapshot.projectRef === BOTH_STAGE_PROJECT_REF ? 'YES' : 'NO';

console.log(
  [
    `App Variant: ${snapshot.variant}`,
    `Supabase Host: ${snapshot.supabaseHost}`,
    `Project Ref: ${snapshot.projectRef ?? '(unknown)'}`,
    `Both STAGE: ${stage}`,
    `Legacy: ${legacy}`,
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

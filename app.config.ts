import type { ExpoConfig, ConfigContext } from 'expo/config';

type AppVariant = 'development' | 'preview' | 'production';

const LEGACY_SCHEME = 'unify';

const VARIANTS = {
  development: {
    name: 'Both DEV',
    bundleId: 'com.bothcalendarsync.app.dev',
    scheme: 'both-dev',
  },
  preview: {
    name: 'Both STG',
    bundleId: 'com.bothcalendarsync.app.staging',
    scheme: 'both-stg',
  },
  production: {
    name: 'Both: Calendar Sync',
    bundleId: 'com.bothcalendarsync.app',
    scheme: 'both',
  },
} as const satisfies Record<AppVariant, { name: string; bundleId: string; scheme: string }>;

function resolveVariant(): AppVariant {
  const raw = process.env.APP_VARIANT;
  if (raw === 'preview' || raw === 'production' || raw === 'development') return raw;
  return 'development';
}

export default ({ config }: ConfigContext): ExpoConfig => {
  const variant = resolveVariant();
  const current = VARIANTS[variant];
  // Incoming `unify` remains registered; generated OAuth callbacks use `current.scheme`.
  const schemes = [current.scheme, LEGACY_SCHEME];

  return {
    ...config,
    name: current.name,
    slug: 'both-calendar-sync',
    version: '0.1.0',
    orientation: 'portrait',
    icon: './assets/images/icon.png',
    scheme: schemes,
    userInterfaceStyle: 'automatic',
    ios: {
      supportsTablet: true,
      bundleIdentifier: current.bundleId,
      usesAppleSignIn: true,
      infoPlist: {
        CFBundleAllowMixedLocalizations: true,
        CFBundleDisplayName: current.name,
        ITSAppUsesNonExemptEncryption: false,
      },
      // Universal Links — configure associatedDomains after production domain is ready.
      // associatedDomains: ['applinks:app.YOUR_DOMAIN'],
    },
    android: {
      package: current.bundleId,
      adaptiveIcon: {
        backgroundColor: '#E8F1FF',
        foregroundImage: './assets/images/android-icon-foreground.png',
        backgroundImage: './assets/images/android-icon-background.png',
        monochromeImage: './assets/images/android-icon-monochrome.png',
      },
      predictiveBackGestureEnabled: false,
      permissions: [],
      intentFilters: [
        {
          action: 'VIEW',
          autoVerify: false,
          data: schemes.map((scheme) => ({ scheme, host: 'oauth' })),
          category: ['BROWSABLE', 'DEFAULT'],
        },
      ],
    },
    web: {
      bundler: 'metro',
      output: 'single',
      favicon: './assets/images/favicon.png',
    },
    plugins: [
      'expo-router',
      'expo-dev-client',
      'expo-secure-store',
      'expo-localization',
      'expo-web-browser',
      'expo-apple-authentication',
      'expo-system-ui',
      [
        'expo-splash-screen',
        {
          image: './assets/images/splash-icon.png',
          resizeMode: 'contain',
          backgroundColor: '#f8fafc',
          dark: {
            backgroundColor: '#0b1220',
            image: './assets/images/splash-icon.png',
          },
        },
      ],
      [
        'expo-build-properties',
        {
          android: {
            compileSdkVersion: 36,
            targetSdkVersion: 36,
            buildToolsVersion: '36.0.0',
          },
          ios: {
            deploymentTarget: '16.4',
          },
        },
      ],
    ],
    experiments: {
      typedRoutes: true,
    },
    extra: {
      appVariant: variant,
      appScheme: current.scheme,
      // Incoming deep links may still use `unify`; generated callbacks use appScheme.
      legacyAppScheme: LEGACY_SCHEME,
      bundleIdentifier: current.bundleId,
      appUrl: process.env.EXPO_PUBLIC_APP_URL ?? process.env.APP_URL ?? '',
      revenueCatIosKey: process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY ?? '',
      revenueCatAndroidKey: process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY ?? '',
      eas: {
        // Fill after `eas init` — do not invent a project ID.
        projectId: process.env.EAS_PROJECT_ID ?? undefined,
      },
      router: {},
    },
    owner: process.env.EAS_OWNER ?? undefined,
  };
};

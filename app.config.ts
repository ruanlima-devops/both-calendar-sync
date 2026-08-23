import type { ExpoConfig, ConfigContext } from 'expo/config';

const APP_SCHEME = 'unify';
const BUNDLE_ID = 'app.unify.calendar';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'Unify',
  slug: 'unify',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/images/icon.png',
  scheme: APP_SCHEME,
  userInterfaceStyle: 'automatic',
  ios: {
    supportsTablet: true,
    bundleIdentifier: BUNDLE_ID,
    usesAppleSignIn: true,
    infoPlist: {
      CFBundleAllowMixedLocalizations: true,
      CFBundleDisplayName: 'Unify',
      ITSAppUsesNonExemptEncryption: false,
    },
    // Universal Links — configure associatedDomains after production domain is ready.
    // associatedDomains: ['applinks:app.YOUR_DOMAIN'],
  },
  android: {
    package: BUNDLE_ID,
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
        data: [{ scheme: APP_SCHEME, host: 'oauth' }],
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
    appScheme: APP_SCHEME,
    bundleIdentifier: BUNDLE_ID,
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
});

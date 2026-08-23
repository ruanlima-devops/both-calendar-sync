import { Platform } from 'react-native';
import Purchases, {
  LOG_LEVEL,
  type CustomerInfo,
  type PurchasesPackage,
} from 'react-native-purchases';
import Constants from 'expo-constants';
import { RC_ENTITLEMENT_ID } from '@/lib/app';

let configured = false;

function rcApiKey(): string | null {
  const extra = Constants.expoConfig?.extra as
    | { revenueCatIosKey?: string; revenueCatAndroidKey?: string }
    | undefined;
  if (Platform.OS === 'ios') {
    return process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY || extra?.revenueCatIosKey || null;
  }
  if (Platform.OS === 'android') {
    return process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY || extra?.revenueCatAndroidKey || null;
  }
  return null;
}

export function isNativeStoreBilling(): boolean {
  return Platform.OS === 'ios' || Platform.OS === 'android';
}

export async function configurePurchases(appUserId: string): Promise<boolean> {
  if (!isNativeStoreBilling()) return false;
  const apiKey = rcApiKey();
  if (!apiKey) return false;

  if (__DEV__) {
    Purchases.setLogLevel(LOG_LEVEL.DEBUG);
  }

  if (!configured) {
    Purchases.configure({ apiKey, appUserID: appUserId });
    configured = true;
  } else {
    await Purchases.logIn(appUserId);
  }
  return true;
}

export async function logOutPurchases(): Promise<void> {
  if (!configured || !isNativeStoreBilling()) return;
  try {
    await Purchases.logOut();
  } catch {
    /* anonymous reset may fail if already anonymous */
  }
}

export function hasUnifyPro(info: CustomerInfo): boolean {
  return Boolean(info.entitlements.active[RC_ENTITLEMENT_ID]);
}

export async function getCustomerInfo(): Promise<CustomerInfo | null> {
  if (!configured) return null;
  return Purchases.getCustomerInfo();
}

export async function getMonthlyPackage(): Promise<PurchasesPackage | null> {
  if (!configured) return null;
  const offerings = await Purchases.getOfferings();
  const current = offerings.current;
  if (!current) return null;
  return (
    current.monthly ??
    current.availablePackages.find((p) => p.identifier.includes('month')) ??
    current.availablePackages[0] ??
    null
  );
}

export async function purchaseMonthly(): Promise<CustomerInfo> {
  const pack = await getMonthlyPackage();
  if (!pack) throw new Error('PRODUCT_UNAVAILABLE');
  const { customerInfo } = await Purchases.purchasePackage(pack);
  return customerInfo;
}

export async function restorePurchases(): Promise<CustomerInfo> {
  return Purchases.restorePurchases();
}

export function storeManageUrl(): string {
  if (Platform.OS === 'ios') {
    return 'https://apps.apple.com/account/subscriptions';
  }
  return 'https://play.google.com/store/account/subscriptions';
}

export function billingProviderLabel(provider: string | null | undefined): string {
  switch (provider) {
    case 'stripe':
      return 'Web (Stripe)';
    case 'apple':
      return 'App Store';
    case 'google':
      return 'Google Play';
    case 'internal':
      return 'Teste Both';
    default:
      return provider ?? '—';
  }
}

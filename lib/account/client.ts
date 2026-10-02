import { invokeFunction, supabase } from '@/lib/supabase';

export async function deleteAccountAndSignOut(): Promise<void> {
  await invokeFunction('delete-account');
  await supabase.auth.signOut({ scope: 'local' });
}

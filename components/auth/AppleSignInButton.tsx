import { StyleSheet } from 'react-native';
import * as AppleAuthentication from 'expo-apple-authentication';
import { layout } from '@/lib/theme';

export function AppleSignInButton({
  dark,
  busy,
  onPress,
}: {
  dark?: boolean;
  busy?: boolean;
  onPress: () => void;
}) {
  return (
    <AppleAuthentication.AppleAuthenticationButton
      buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
      buttonStyle={
        dark
          ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE
          : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK
      }
      cornerRadius={14}
      style={[styles.native, busy ? styles.busy : null]}
      onPress={busy ? () => undefined : onPress}
    />
  );
}

const styles = StyleSheet.create({
  native: {
    width: '100%',
    height: layout.tapTarget,
  },
  busy: {
    opacity: 0.55,
  },
});

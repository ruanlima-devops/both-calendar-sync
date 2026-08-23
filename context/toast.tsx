import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Animated, Pressable, Text } from 'react-native';
import { useSession } from '@/context/session';
import { space } from '@/lib/theme';

interface ToastContextValue {
  showToast: (message: string) => void;
}

const ToastCtx = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const { theme } = useSession();
  const [message, setMessage] = useState<string | null>(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hide = useCallback(() => {
    Animated.timing(opacity, { toValue: 0, duration: 180, useNativeDriver: true }).start(() => {
      setMessage(null);
    });
  }, [opacity]);

  const showToast = useCallback(
    (text: string) => {
      if (timer.current) clearTimeout(timer.current);
      setMessage(text);
      Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }).start();
      timer.current = setTimeout(hide, 2800);
    },
    [hide, opacity],
  );

  const value = useMemo(() => ({ showToast }), [showToast]);

  return (
    <ToastCtx.Provider value={value}>
      {children}
      {message ? (
        <Animated.View
          pointerEvents="box-none"
          style={{
            position: 'absolute',
            left: space.lg,
            right: space.lg,
            bottom: space.xxl,
            opacity,
            zIndex: 100,
            alignItems: 'center',
          }}
        >
          <Pressable
            onPress={hide}
            style={{
              backgroundColor: theme.text,
              borderRadius: theme.radius,
              paddingHorizontal: space.lg,
              paddingVertical: space.md,
              maxWidth: 420,
            }}
          >
            <Text style={{ color: theme.bg, fontWeight: '600', textAlign: 'center' }}>{message}</Text>
          </Pressable>
        </Animated.View>
      ) : null}
    </ToastCtx.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error('useToast outside provider');
  return ctx;
}

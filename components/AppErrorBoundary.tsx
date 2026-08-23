import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';

type Props = { children: ReactNode };
type State = { error: Error | null };

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[UnifyErrorBoundary]', error.message, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 }}>
        <Text style={{ fontSize: 18, fontWeight: '700', textAlign: 'center' }}>Algo deu errado</Text>
        <Text style={{ textAlign: 'center', opacity: 0.7 }}>
          Reinicie a tela. Se o problema continuar, feche e abra o Unify.
        </Text>
        <Pressable
          onPress={() => this.setState({ error: null })}
          style={{ paddingVertical: 12, paddingHorizontal: 16, minHeight: 44 }}
          accessibilityRole="button"
        >
          <Text style={{ fontWeight: '600' }}>Tentar de novo</Text>
        </Pressable>
      </View>
    );
  }
}

import React, { ReactNode } from 'react';
import { SafeAreaView, StyleSheet, Text } from 'react-native';
import { ThemedText } from './themed-text';
import { ThemedView } from './themed-view';

interface Props {
  children: ReactNode;
  fallback?: (error: Error, retry: () => void) => ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * Error Boundary component for React Native
 * Catches errors in child components and displays error UI
 * Prevents entire app crash on component errors
 */
export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    // Log error to external service in production
    console.error('Error caught by boundary:', error);
    console.error('Error info:', errorInfo);

    // You could send this to an error tracking service like Sentry
    if (process.env.NODE_ENV === 'production') {
      // captureException(error, { contexts: { react: errorInfo } });
    }
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback ? (
          this.props.fallback(this.state.error!, this.handleRetry)
        ) : (
          <SafeAreaView style={styles.container}>
            <ThemedView style={styles.errorContainer}>
              <ThemedText type="title" style={styles.errorTitle}>
                Oops!
              </ThemedText>
              <ThemedText style={styles.errorMessage}>
                Something went wrong while displaying this screen.
              </ThemedText>
              {process.env.NODE_ENV !== 'production' && (
                <Text style={styles.errorDetails}>
                  {this.state.error?.toString()}
                </Text>
              )}
              <ThemedText
                style={styles.retryButton}
                onPress={this.handleRetry}
              >
                Try Again
              </ThemedText>
            </ThemedView>
          </SafeAreaView>
        )
      );
    }

    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  errorTitle: {
    marginBottom: 12,
    textAlign: 'center',
    fontSize: 24,
    fontWeight: 'bold',
  },
  errorMessage: {
    textAlign: 'center',
    marginBottom: 16,
    fontSize: 16,
  },
  errorDetails: {
    fontSize: 12,
    color: '#666',
    marginBottom: 16,
    padding: 8,
    backgroundColor: '#f5f5f5',
    borderRadius: 4,
    fontFamily: 'monospace',
  },
  retryButton: {
    marginTop: 16,
    paddingVertical: 12,
    paddingHorizontal: 24,
    backgroundColor: '#007AFF',
    color: '#fff',
    borderRadius: 8,
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
    overflow: 'hidden',
  },
});

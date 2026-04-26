/**
 * AnimatedPressable — Pressable with spring scale-down feedback on press.
 *
 * Drop-in replacement for React Native's Pressable that adds a satisfying
 * press animation using react-native-reanimated springs.
 *
 * @prop scaleValue - How much to scale down on press (default 0.96).
 *   Use 0.96 for buttons, 0.98 for cards.
 */

import * as Haptics from 'expo-haptics';
import { useCallback } from 'react';
import {
    Pressable,
    type GestureResponderEvent,
    type PressableProps,
    type PressableStateCallbackType,
} from 'react-native';
import Animated, {
    useAnimatedStyle,
    useSharedValue,
    withSpring,
} from 'react-native-reanimated';

const AnimatedPressableBase = Animated.createAnimatedComponent(Pressable);

const SPRING_CONFIG = {
  damping: 15,
  stiffness: 300,
  mass: 0.6,
  overshootClamping: false,
  restDisplacementThreshold: 0.01,
  restSpeedThreshold: 0.01,
};

type AnimatedPressableProps = PressableProps & {
  /** Scale factor when pressed. 0.96 for buttons, 0.98 for cards. */
  scaleValue?: number;
  /** Whether to fire a light haptic on press. Defaults to false. */
  haptic?: boolean;
};

export function AnimatedPressable({
  scaleValue = 0.96,
  haptic = false,
  onPressIn,
  onPressOut,
  onPress,
  style,
  disabled,
  ...rest
}: AnimatedPressableProps) {
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = useCallback(
    (e: GestureResponderEvent) => {
      scale.value = withSpring(scaleValue, SPRING_CONFIG);
      onPressIn?.(e);
    },
    [scale, scaleValue, onPressIn]
  );

  const handlePressOut = useCallback(
    (e: GestureResponderEvent) => {
      scale.value = withSpring(1, SPRING_CONFIG);
      onPressOut?.(e);
    },
    [scale, onPressOut]
  );

  const handlePress = useCallback(
    (e: GestureResponderEvent) => {
      if (haptic) {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
      onPress?.(e);
    },
    [haptic, onPress]
  );

  const resolveDynamicStyle = useCallback(
    (state: PressableStateCallbackType) => [
      typeof style === 'function' ? style(state) : style,
      animatedStyle,
    ],
    [animatedStyle, style]
  );

  const resolvedStyle =
    typeof style === 'function'
      ? resolveDynamicStyle
      : [style, animatedStyle];

  return (
    <AnimatedPressableBase
      {...rest}
      disabled={disabled}
      onPressIn={disabled ? undefined : handlePressIn}
      onPressOut={disabled ? undefined : handlePressOut}
      onPress={disabled ? undefined : handlePress}
      style={resolvedStyle}
    />
  );
}

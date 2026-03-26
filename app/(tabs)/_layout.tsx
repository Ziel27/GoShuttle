import { Tabs } from 'expo-router';
import React from 'react';
import { Animated, StyleSheet } from 'react-native';

import { HapticTab } from '@/components/haptic-tab';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors, DesignTokens, Fonts } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuthStore } from '@/store/auth';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type TabIconName = React.ComponentProps<typeof IconSymbol>['name'];
type TabIconState = { color: string; focused: boolean };
type TabLabelState = { color: string; focused: boolean };

const palette = {
  sky: '#e0f2fe',
  mint: '#dcfce7',
  amber: '#fef3c7',
  indigo: '#e0e7ff',
  emerald: '#047857',
};

function TabIconBubble({
  color,
  focused,
  activeName,
  inactiveName,
  activeBg,
  activeColor,
}: TabIconState & {
  activeName: TabIconName;
  inactiveName: TabIconName;
  activeBg: string;
  activeColor: string;
}) {
  const scale = React.useRef(new Animated.Value(focused ? 1 : 0.94)).current;

  React.useEffect(() => {
    Animated.spring(scale, {
      toValue: focused ? 1 : 0.94,
      speed: 18,
      bounciness: 8,
      useNativeDriver: true,
    }).start();
  }, [focused, scale]);

  return (
    <Animated.View
      style={[
        styles.iconWrap,
        { transform: [{ scale }] },
        focused && [styles.iconWrapFocused, { backgroundColor: activeBg }],
      ]}>
      <IconSymbol
        name={focused ? activeName : inactiveName}
        size={focused ? 20 : 19}
        color={focused ? activeColor : color}
      />
    </Animated.View>
  );
}

function TabLabelBubble({
  color,
  focused,
  label,
  activeColor,
}: TabLabelState & { label: string; activeColor: string }) {
  const opacity = React.useRef(new Animated.Value(focused ? 1 : 0.78)).current;
  const lift = React.useRef(new Animated.Value(focused ? 0 : 1)).current;

  React.useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: focused ? 1 : 0.78,
        duration: 170,
        useNativeDriver: true,
      }),
      Animated.timing(lift, {
        toValue: focused ? 0 : 1,
        duration: 170,
        useNativeDriver: true,
      }),
    ]).start();
  }, [focused, lift, opacity]);

  return (
    <Animated.Text
      style={[
        styles.tabLabel,
        {
          color: focused ? activeColor : color,
          opacity,
          transform: [{ translateY: lift }],
        },
      ]}>
      {label}
    </Animated.Text>
  );
}

export default function TabLayout() {
  const colorScheme = useColorScheme();
  const theme = colorScheme ?? 'light';
  const isDark = theme === 'dark';
  const insets = useSafeAreaInsets();
  const userRole = useAuthStore((state) => state.user?.role);
  const isPassenger = userRole === 'passenger';
  const isDriver = userRole === 'driver';
  const activeTint = isDriver ? palette.emerald : Colors[theme].tint;
  const tabBg = Colors[theme].surface;
  const tabInactive = Colors[theme].icon;
  const textStrong = Colors[theme].text;
  const homeActiveBg = isDark ? '#1e293b' : palette.sky;
  const ridesActiveBg = isDark ? '#3f2f14' : palette.amber;
  const fleetActiveBg = isDark ? '#1f2548' : palette.indigo;
  const opsActiveBg = isDark ? '#113b2c' : palette.mint;
  const settingsActiveBg = isDark ? '#1e293b' : palette.sky;
  const extraBottomInset = Math.max(insets.bottom, 0);

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: activeTint,
        tabBarInactiveTintColor: tabInactive,
        headerShown: false,
        tabBarButton: HapticTab,
        tabBarHideOnKeyboard: true,
        tabBarStyle: {
          height: 72 + extraBottomInset,
          borderTopWidth: 0,
          backgroundColor: tabBg,
          paddingTop: DesignTokens.spacing.xs,
          paddingBottom: DesignTokens.spacing.xs + extraBottomInset,
          paddingHorizontal: DesignTokens.spacing.xs,
          elevation: 10,
        },
        tabBarLabelStyle: {
          fontSize: DesignTokens.typography.overline.fontSize,
          fontWeight: '700',
          marginTop: -1,
          fontFamily: Fonts?.sans,
        },
        tabBarItemStyle: {
          borderRadius: DesignTokens.radius.md,
          marginHorizontal: 1,
        },
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: isDriver ? 'Driver' : 'Home',
          tabBarLabel: (props) => (
            <TabLabelBubble
              {...props}
              label={isDriver ? 'Driver' : 'Home'}
              activeColor={isDriver ? palette.emerald : textStrong}
            />
          ),
          tabBarIcon: (props) =>
            <TabIconBubble
              {...props}
              activeName="house.fill"
              inactiveName="house"
              activeBg={isDriver ? opsActiveBg : homeActiveBg}
              activeColor={isDriver ? palette.emerald : textStrong}
            />,
        }}
      />
      <Tabs.Screen
        name="rides"
        options={{
          href: isPassenger ? undefined : null,
          title: 'Rides',
          tabBarLabel: (props) => (
            <TabLabelBubble {...props} label="Rides" activeColor={isDark ? '#fbbf24' : '#92400e'} />
          ),
          tabBarIcon: (props) => (
            <TabIconBubble
              {...props}
              activeName="clock.fill"
              inactiveName="clock"
              activeBg={ridesActiveBg}
              activeColor={isDark ? '#fbbf24' : '#92400e'}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="explore"
        options={{
          title: isDriver ? 'Ops' : 'Fleet',
          tabBarLabel: (props) => (
            <TabLabelBubble
              {...props}
              label={isDriver ? 'Ops' : 'Fleet'}
              activeColor={isDriver ? palette.emerald : isDark ? '#a5b4fc' : '#3730a3'}
            />
          ),
          tabBarIcon: (props) =>
            isDriver
              ? <TabIconBubble {...props} activeName="bus" inactiveName="bus" activeBg={opsActiveBg} activeColor={palette.emerald} />
              : <TabIconBubble {...props} activeName="paperplane" inactiveName="paperplane" activeBg={fleetActiveBg} activeColor={isDark ? '#a5b4fc' : '#3730a3'} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarLabel: (props) => (
            <TabLabelBubble {...props} label="Settings" activeColor={textStrong} />
          ),
          tabBarIcon: (props) => (
            <TabIconBubble
              {...props}
              activeName="gearshape.fill"
              inactiveName="gearshape"
              activeBg={settingsActiveBg}
              activeColor={textStrong}
            />
          ),
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  iconWrap: {
    minWidth: 34,
    minHeight: 30,
    borderRadius: DesignTokens.radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconWrapFocused: {
    shadowColor: '#0f172a',
    shadowOpacity: 0.12,
    shadowOffset: { width: 0, height: 3 },
    shadowRadius: 6,
    elevation: 2,
  },
  tabLabel: {
    fontSize: DesignTokens.typography.overline.fontSize,
    fontWeight: '700',
    marginTop: -1,
    letterSpacing: 0.2,
    fontFamily: Fonts?.sans,
  },
});

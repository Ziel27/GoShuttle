import { Tabs } from 'expo-router';
import React from 'react';
import { Animated, StyleSheet, View } from 'react-native';

import { HapticTab } from '@/components/haptic-tab';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { AppPalette } from '@/constants/app-ui';
import { Colors, DesignTokens, OutfitFonts } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuthStore } from '@/store/auth';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type TabIconName = React.ComponentProps<typeof IconSymbol>['name'];
type TabIconState = { color: string; focused: boolean };
type TabLabelState = { color: string; focused: boolean };



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
      {focused ? <View style={[styles.activeDot, { backgroundColor: activeColor }]} /> : null}
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
  const activeTint = isDriver ? AppPalette.driverTint : Colors[theme].tint;
  const tabBg = Colors[theme].surface;
  const tabInactive = Colors[theme].tabIconDefault;
  const homeActiveBg = isDark ? AppPalette.darkSkyBg : AppPalette.sky;
  const ridesActiveBg = isDark ? AppPalette.darkAmberBg : AppPalette.amber;
  const fleetActiveBg = isDark ? AppPalette.darkIndigoBg : AppPalette.indigo;
  const opsActiveBg = isDark ? AppPalette.darkMintBg : AppPalette.mint;
  const settingsActiveBg = isDark ? AppPalette.darkSkyBg : AppPalette.sky;
  const announcementsActiveBg = isDark ? AppPalette.darkAmberBg : AppPalette.amber;
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
          height: 64 + extraBottomInset,
          borderTopWidth: 1,
          borderTopColor: Colors[theme].border,
          backgroundColor: tabBg,
          paddingTop: DesignTokens.spacing.sm,
          paddingBottom: Math.max(extraBottomInset, DesignTokens.spacing.sm),
          paddingHorizontal: DesignTokens.spacing.sm,
          elevation: 8,
        },
        tabBarLabelStyle: {
          fontSize: DesignTokens.typography.overline.fontSize,
          fontFamily: OutfitFonts.bold,
          marginTop: 0,
        },
        tabBarItemStyle: {
          borderRadius: DesignTokens.radius.md,
          marginHorizontal: 2,
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
              activeColor={activeTint}
            />
          ),
          tabBarIcon: (props) =>
            <TabIconBubble
              {...props}
              activeName="house.fill"
              inactiveName="house"
              activeBg={isDriver ? opsActiveBg : homeActiveBg}
              activeColor={activeTint}
            />,
        }}
      />
      <Tabs.Screen
        name="rides"
        options={{
          href: isPassenger ? undefined : null,
          title: 'Rides',
          tabBarLabel: (props) => (
            <TabLabelBubble {...props} label="Rides" activeColor={activeTint} />
          ),
          tabBarIcon: (props) => (
            <TabIconBubble
              {...props}
              activeName="clock.fill"
              inactiveName="clock"
              activeBg={ridesActiveBg}
              activeColor={activeTint}
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
              activeColor={activeTint}
            />
          ),
          tabBarIcon: (props) =>
            isDriver
              ? <TabIconBubble {...props} activeName="bus" inactiveName="bus" activeBg={opsActiveBg} activeColor={activeTint} />
              : <TabIconBubble {...props} activeName="paperplane" inactiveName="paperplane" activeBg={fleetActiveBg} activeColor={activeTint} />,
        }}
      />
      <Tabs.Screen
        name="announcements"
        options={{
          title: 'Announcements',
          tabBarLabel: (props) => (
            <TabLabelBubble {...props} label="Updates" activeColor={activeTint} />
          ),
          tabBarIcon: (props) => (
            <TabIconBubble
              {...props}
              activeName="bell.fill"
              inactiveName="bell"
              activeBg={announcementsActiveBg}
              activeColor={activeTint}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarLabel: (props) => (
            <TabLabelBubble {...props} label="Settings" activeColor={activeTint} />
          ),
          tabBarIcon: (props) => (
            <TabIconBubble
              {...props}
              activeName="gearshape.fill"
              inactiveName="gearshape"
              activeBg={settingsActiveBg}
              activeColor={activeTint}
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
    minHeight: 32,
    borderRadius: DesignTokens.radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  iconWrapFocused: {
    shadowColor: AppPalette.navy,
    shadowOpacity: 0.10,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 4,
    elevation: 2,
  },
  activeDot: {
    position: 'absolute',
    top: -6,
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  tabLabel: {
    fontSize: DesignTokens.typography.overline.fontSize,
    marginTop: 1,
    letterSpacing: 0.2,
    fontFamily: OutfitFonts.bold,
  },
});

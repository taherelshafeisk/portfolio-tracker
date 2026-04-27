import { Tabs } from "expo-router";
import React from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors } from "@/constants/colors";
import { fonts } from "@/constants/fonts";

function TabIcon({ label, focused }: { label: string; focused: boolean }) {
  return (
    <View style={styles.tabItem}>
      <Text style={[styles.tabLabel, focused && styles.tabLabelFocused]}>
        {label}
      </Text>
      {focused && <View style={styles.dot} />}
    </View>
  );
}

export default function TabLayout() {
  const insets = useSafeAreaInsets();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: colors.bg,
          borderTopWidth: 1,
          borderTopColor: colors.hair2,
          elevation: 0,
          height: 49 + insets.bottom,
          paddingBottom: insets.bottom,
          ...(Platform.OS === 'web' ? { height: 64 } : {}),
        },
        tabBarLabelStyle: { display: 'none' },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          tabBarLabel: 'Today',
          tabBarIcon: ({ focused }) => <TabIcon label="Today" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="accounts"
        options={{
          tabBarLabel: 'Portfolio',
          tabBarIcon: ({ focused }) => <TabIcon label="Portfolio" focused={focused} />,
        }}
      />
      <Tabs.Screen name="pulse" options={{ href: null }} />
      <Tabs.Screen
        name="trade"
        options={{
          tabBarLabel: 'Decide',
          tabBarIcon: ({ focused }) => <TabIcon label="Decide" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="ai"
        options={{
          tabBarLabel: 'Coach',
          tabBarIcon: ({ focused }) => <TabIcon label="Coach" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="screener"
        options={{
          tabBarLabel: 'Screen',
          tabBarIcon: ({ focused }) => <TabIcon label="Screen" focused={focused} />,
        }}
      />
      {/* Hidden from tab bar */}
      <Tabs.Screen name="activity" options={{ href: null }} />
      <Tabs.Screen name="feed" options={{ href: null }} />
      <Tabs.Screen name="journal" options={{ href: null }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabItem: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 10,
    paddingHorizontal: 4,
    paddingBottom: 4,
  },
  tabLabel: {
    fontFamily: fonts.serif,
    fontSize: 11,
    letterSpacing: -0.05,
    color: colors.ink3,
  },
  tabLabelFocused: {
    color: colors.ink,
    fontFamily: fonts.serifMedium,
  },
  dot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.accent,
    marginTop: 4,
  },
});

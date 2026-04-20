import { BlurView } from "expo-blur";
import { Tabs, router } from "expo-router";
import { Feather } from "@expo/vector-icons";
import React from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors } from "@/constants/colors";
import { useAIContext, type AIContextPayload } from "@/hooks/useAIContext";

const FAB_SIZE = 52;
const TAB_BAR_HEIGHT = 49;

function deriveBadge(ctx: AIContextPayload): string | null {
  if (!ctx) return null;
  switch (ctx.screen) {
    case 'home':
      return ctx.violations.length > 0 ? `Home · ${ctx.violations.length} violations` : null;
    case 'position_detail':
      return `${ctx.ticker} · ${ctx.pnl_pct >= 0 ? '+' : ''}${ctx.pnl_pct.toFixed(1)}%`;
    case 'trade_swings':
      return `Swings · ${ctx.positions.length} open`;
    case 'sleeve_detail':
      return ctx.sleeve_name;
    case 'screener_result':
      return `${ctx.ticker} · ${ctx.stage}`;
    default:
      return null;
  }
}

export default function TabLayout() {
  const isIOS = Platform.OS === "ios";
  const isWeb = Platform.OS === "web";
  const insets = useSafeAreaInsets();
  const { aiContext } = useAIContext();

  const tabBarH = TAB_BAR_HEIGHT + insets.bottom;
  const fabBottom = tabBarH + 12;
  const badge = deriveBadge(aiContext);

  return (
    <View style={{ flex: 1 }}>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: colors.primary,
          tabBarInactiveTintColor: colors.tabIconDefault,
          tabBarStyle: {
            position: "absolute",
            backgroundColor: isIOS ? "transparent" : colors.background,
            borderTopWidth: 1,
            borderTopColor: colors.separator,
            elevation: 0,
            ...(isWeb ? { height: 64 } : {}),
          },
          tabBarBackground: () =>
            isIOS ? (
              <BlurView intensity={80} tint="dark" style={StyleSheet.absoluteFill} />
            ) : (
              <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.background }]} />
            ),
          tabBarLabelStyle: {
            fontFamily: "Inter_500Medium",
            fontSize: 11,
          },
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: "Portfolio",
            tabBarIcon: ({ color }) => <Feather name="pie-chart" size={22} color={color} />,
          }}
        />
        <Tabs.Screen
          name="accounts"
          options={{
            title: "Accounts",
            tabBarIcon: ({ color }) => <Feather name="briefcase" size={22} color={color} />,
          }}
        />
        <Tabs.Screen
          name="trade"
          options={{
            title: "Trade",
            tabBarIcon: ({ color }) => <Feather name="trending-up" size={22} color={color} />,
          }}
        />
        <Tabs.Screen
          name="feed"
          options={{
            title: "Signals",
            tabBarIcon: ({ color }) => <Feather name="radio" size={22} color={color} />,
          }}
        />
        <Tabs.Screen
          name="activity"
          options={{
            title: "Activity",
            tabBarIcon: ({ color }) => <Feather name="activity" size={22} color={color} />,
          }}
        />
        {/* Hidden from tab bar — accessible via FAB / direct navigation */}
        <Tabs.Screen name="ai" options={{ href: null }} />
        <Tabs.Screen name="screener" options={{ href: null }} />
        <Tabs.Screen name="journal" options={{ href: null }} />
      </Tabs>

      {/* Floating AI button */}
      <View style={[styles.fabContainer, { bottom: fabBottom }]}>
        {badge && (
          <View style={styles.fabBadge}>
            <Text style={styles.fabBadgeText} numberOfLines={1}>{badge}</Text>
          </View>
        )}
        <Pressable
          style={styles.fab}
          onPress={() => router.push({ pathname: '/ai', params: aiContext ? { context: JSON.stringify(aiContext) } : {} })}
          accessibilityLabel="Open AI Advisor"
        >
          <Feather name="cpu" size={22} color={colors.background} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fabContainer: {
    position: "absolute",
    right: 20,
    alignItems: "flex-end",
  },
  fabBadge: {
    backgroundColor: "rgba(0,0,0,0.65)",
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginBottom: 6,
    maxWidth: 160,
  },
  fabBadgeText: {
    color: "#ffffff",
    fontSize: 11,
    fontFamily: "Inter_500Medium",
  },
  fab: {
    width: FAB_SIZE,
    height: FAB_SIZE,
    borderRadius: FAB_SIZE / 2,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    elevation: 8,
    ...Platform.select({
      web: { boxShadow: `0 4px 16px ${colors.primary}70` },
      default: {
        shadowColor: colors.primary,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.45,
        shadowRadius: 8,
      },
    }),
  },
});

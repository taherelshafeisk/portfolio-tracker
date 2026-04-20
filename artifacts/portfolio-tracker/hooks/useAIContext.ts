import React, { createContext, useContext, useState } from 'react';

export type AIContextPayload =
  | {
      screen: 'home';
      violations: { type: string; severity: string; detail: string }[];
      macro_posture: string;
      sleeves_summary: { name: string; value: number; change_pct: number }[];
    }
  | {
      screen: 'position_detail';
      ticker: string;
      name: string;
      sleeve: string;
      qty: number;
      avg_cost: number;
      current_price: number;
      pnl_pct: number;
      stop?: number;
      target?: number;
      ips_flags: { rule: string; detail: string }[];
      macro_tag?: string;
      thesis?: string;
    }
  | {
      screen: 'trade_swings';
      total_allocated: number;
      target: number;
      utilization_pct: number;
      positions: { ticker: string; pnl_pct: number; days_held: number; stop_set: boolean }[];
      macro_posture: string;
    }
  | {
      screen: 'sleeve_detail';
      sleeve_name: string;
      total_value: number;
      leverage?: number;
      positions: { ticker: string; weight_pct: number; ips_flags: string[] }[];
    }
  | {
      screen: 'screener_result';
      ticker: string;
      price: number;
      stage: string;
      rsi: number;
      ema_status: string[];
      ips_headroom: { bucket_available: boolean; leverage_ok: boolean };
    }
  | null;

interface AIContextValue {
  aiContext: AIContextPayload;
  setAIContext: (payload: AIContextPayload) => void;
}

const AIContext = createContext<AIContextValue>({
  aiContext: null,
  setAIContext: () => {},
});

export function AIContextProvider({ children }: { children: React.ReactNode }) {
  const [aiContext, setAIContext] = useState<AIContextPayload>(null);
  return React.createElement(
    AIContext.Provider,
    { value: { aiContext, setAIContext } },
    children,
  );
}

export function useAIContext(): AIContextValue {
  return useContext(AIContext);
}

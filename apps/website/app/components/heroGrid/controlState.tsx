"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

/** Market activity tier — gates tick density in the replay engine (not playback speed). */
export type RateTier = 10 | 60 | 250;

export interface HeroGridControlState {
  ratePerSec: RateTier;
  setRatePerSec: (rate: RateTier) => void;
  isPaused: boolean;
  setIsPaused: (paused: boolean) => void;
  isDrawerOpen: boolean;
  setIsDrawerOpen: (open: boolean) => void;
  isPlaying: boolean;
}

const ControlStateContext = createContext<HeroGridControlState | null>(null);

export function ControlStateProvider({ children }: { children: ReactNode }) {
  const [ratePerSec, setRatePerSec] = useState<RateTier>(60);
  const [isPaused, setIsPaused] = useState(false);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  const setRate = useCallback((rate: RateTier) => setRatePerSec(rate), []);
  const setPaused = useCallback((paused: boolean) => setIsPaused(paused), []);
  const setOpen = useCallback((open: boolean) => setIsDrawerOpen(open), []);

  const value = useMemo<HeroGridControlState>(
    () => ({
      ratePerSec,
      setRatePerSec: setRate,
      isPaused,
      setIsPaused: setPaused,
      isDrawerOpen,
      setIsDrawerOpen: setOpen,
      isPlaying: !isPaused && !isDrawerOpen,
    }),
    [ratePerSec, isPaused, isDrawerOpen, setRate, setPaused, setOpen],
  );

  return (
    <ControlStateContext.Provider value={value}>
      {children}
    </ControlStateContext.Provider>
  );
}

export function useControlState(): HeroGridControlState {
  const ctx = useContext(ControlStateContext);
  if (!ctx) {
    throw new Error("useControlState must be used inside ControlStateProvider");
  }
  return ctx;
}

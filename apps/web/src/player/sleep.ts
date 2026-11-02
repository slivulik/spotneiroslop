"use client";

import { create } from "zustand";

/** Sleep timer state: a wall-clock deadline, or "stop when this track ends". */
export type SleepState = { endsAt: number | null; endOfTrack: boolean };

export const useSleep = create<SleepState>(() => ({ endsAt: null, endOfTrack: false }));

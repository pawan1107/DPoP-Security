"use client";

import React, { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { BotDetector, BotDetectionReason } from "../app/lib/anti-bot";

interface BotProtectionContextType {
  isBotDetected: boolean;
  detectionReasons: BotDetectionReason[];
}

const BotProtectionContext = createContext<BotProtectionContextType>({
  isBotDetected: false,
  detectionReasons: [],
});

export const useBotProtection = () => useContext(BotProtectionContext);

export function BotProtectionProvider({ children }: { children: ReactNode }) {
  const [isBotDetected, setIsBotDetected] = useState(false);
  const [detectionReasons, setDetectionReasons] = useState<BotDetectionReason[]>([]);

  useEffect(() => {
    const handleDetection = (reason: BotDetectionReason) => {
      setIsBotDetected(true);
      setDetectionReasons((prev) => {
        if (!prev.includes(reason)) {
          return [...prev, reason];
        }
        return prev;
      });
      // Optionally log to backend or analytics here
      console.warn(`🚨 Bot Detected: ${reason}`);
    };

    const detector = new BotDetector(handleDetection);
    detector.start();

    return () => {
      detector.stop();
    };
  }, []);

  return (
    <BotProtectionContext.Provider value={{ isBotDetected, detectionReasons }}>
      {children}
      {isBotDetected && (
        <div className="fixed top-0 left-0 w-full bg-red-600 text-white p-2 text-center font-bold z-50 animate-pulse">
          🚨 Security Alert: Automated Browser / Bot Detected! Access Restricted. 🚨
          <br/>
          <span className="text-xs font-mono bg-black/30 px-2 py-1 rounded mt-1 inline-block">
            Reason(s): {detectionReasons.join(", ")}
          </span>
        </div>
      )}
    </BotProtectionContext.Provider>
  );
}

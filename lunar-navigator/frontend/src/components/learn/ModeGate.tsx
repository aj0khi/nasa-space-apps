// Beginner / Expert switches for any part of the UI. Owner: LEAD.
//   Beginner: plain-language verdicts first, raw angles hidden.
//   Expert: assumes degree-level knowledge, shows every number and the "what if" controls.
import type { ReactNode } from "react";
import { useApp } from "../../state/store";

export const useExpert = () => useApp((s) => s.mode === "expert");

export function ExpertOnly({ children }: { children: ReactNode }) {
  return useExpert() ? <>{children}</> : null;
}

export function BeginnerOnly({ children }: { children: ReactNode }) {
  return useExpert() ? null : <>{children}</>;
}

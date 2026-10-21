import { createContext, useContext, type ReactNode } from "react";

export type Ask = { title: string; description?: ReactNode; action: string; destructive?: boolean; alt?: string };
/** true: the action; "alt": the second button (only when `alt` is set); false: cancelled. */
export type Answer = boolean | "alt";

export const ConfirmContext = createContext<(ask: Ask) => Promise<Answer>>(async () => false);

/** `await confirm({...})` asks in a dialog; see ConfirmProvider. */
export function useConfirm() {
  return useContext(ConfirmContext);
}

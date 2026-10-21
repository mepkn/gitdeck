import { useCallback, useRef, useState, type ReactNode } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ConfirmContext, type Answer, type Ask } from "@/lib/confirm";

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [ask, setAsk] = useState<Ask | null>(null);
  const resolver = useRef<((ok: Answer) => void) | null>(null);

  const confirm = useCallback((a: Ask) => {
    resolver.current?.(false);
    setAsk(a);
    return new Promise<Answer>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const close = (ok: Answer) => {
    resolver.current?.(ok);
    resolver.current = null;
    setAsk(null);
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <AlertDialog open={!!ask} onOpenChange={(open) => !open && close(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{ask?.title}</AlertDialogTitle>
            {ask?.description && <AlertDialogDescription>{ask.description}</AlertDialogDescription>}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            {ask?.alt && (
              <AlertDialogAction variant="secondary" onClick={() => close("alt")}>
                {ask.alt}
              </AlertDialogAction>
            )}
            <AlertDialogAction variant={ask?.destructive ? "destructive" : "default"} onClick={() => close(true)}>
              {ask?.action}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ConfirmContext.Provider>
  );
}

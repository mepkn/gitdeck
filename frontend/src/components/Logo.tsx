import { cn } from "@/lib/utils";

/** The app icon, the same file as the favicon. */
export function Logo({ className }: { className?: string }) {
  return <img src="/favicon.svg?v=2" alt="" aria-hidden className={cn("size-6", className)} />;
}

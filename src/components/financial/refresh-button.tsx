"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { IconRefresh } from "@/components/ui/icons";
import { cn } from "@/lib/utils";

/** Re-fetches the current page's server data. Shows a real loading state
 * (spinning icon + disabled) rather than a fake instant success. */
export function RefreshButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [spinning, setSpinning] = useState(false);

  function handleClick() {
    setSpinning(true);
    startTransition(() => {
      router.refresh();
    });
    setTimeout(() => setSpinning(false), 600);
  }

  return (
    <Button variant="outline" size="sm" onClick={handleClick} disabled={isPending}>
      <IconRefresh className={cn("h-3.5 w-3.5", spinning && "animate-spin")} />
      Refresh
    </Button>
  );
}

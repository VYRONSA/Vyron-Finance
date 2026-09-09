"use client";

import { forwardRef, useState } from "react";
import { cn } from "@/lib/utils";
import { IconEye, IconEyeOff } from "@/components/ui/icons";

/** Master Implementation Tracker — Epic E13, Finding #175. No password
 * field anywhere in the app had a show/hide toggle — retrofit once
 * here, reused by every password input rather than fixed per-form. */
export const PasswordInput = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function PasswordInput({ className, ...props }, ref) {
    const [visible, setVisible] = useState(false);
    return (
      <div className="relative">
        <input
          ref={ref}
          type={visible ? "text" : "password"}
          className={cn(
            "w-full rounded-lg border border-vf-paper-border bg-vf-paper px-3.5 py-2.5 pr-10 text-vf-ink outline-none focus:border-vf-red-500",
            className,
          )}
          {...props}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? "Hide password" : "Show password"}
          tabIndex={-1}
          className="absolute right-2.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-vf-ink-faint hover:text-vf-ink"
        >
          {visible ? <IconEyeOff className="h-4 w-4" /> : <IconEye className="h-4 w-4" />}
        </button>
      </div>
    );
  },
);

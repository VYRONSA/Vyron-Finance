"use client";

import * as React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import fuzzysort from "fuzzysort";
import { cn } from "@/lib/utils";

/**
 * Searchable/type-to-filter select — the Transaction Explorer redesign's
 * one new UI primitive (nothing like it existed in `src/components/ui/`
 * before). Built to be embeddable in a dense table cell as well as a
 * normal form field: no portal, a plain absolutely-positioned popup under
 * the trigger input (same convention `transaction-column-chooser.tsx`
 * already uses), fuzzy-filtered via `fuzzysort` over each option's
 * `searchText` (defaults to `label + sublabel` — callers can widen it with
 * aliases/alternative names so "petrol" can surface "Fuel Expenses").
 *
 * Keyboard model (the part a spreadsheet-style grid actually depends on):
 * ArrowUp/ArrowDown only move the popup's own highlighted option, and only
 * `stopPropagation()` while the popup is OPEN — closed, they're left
 * untouched so an ancestor row-navigation handler (e.g. `TransactionGrid`'s
 * "Arrow Down moves to the next transaction") receives them normally via
 * React's own event bubbling. Tab is never `preventDefault()`-ed — it
 * commits the best match synchronously, then native tab order continues
 * to the next field with zero extra JS. Enter commits but also does NOT
 * stop propagation, so a row-level "Enter moves down one row" handler
 * still fires after this component's own commit has already run.
 */
export type ComboboxOption<T extends string | number = string> = {
  value: T;
  label: string;
  sublabel?: string;
  searchText?: string;
  /** Pilot Review Board follow-up — "don't make the user think about
   * different lookup controls." When callers combine options from
   * several sources into one list (e.g. Customers + Suppliers + General
   * Ledger accounts), `group` renders a section header above the first
   * option of each group and controls display order — options are
   * grouped in first-appearance order from the `options` array (fuzzy
   * relevance still decides ranking *within* a group), not resorted by
   * relevance across groups. Omit entirely for an ungrouped list. */
  group?: string;
};

export type ComboboxProps<T extends string | number> = {
  value: T | null;
  options: ComboboxOption<T>[];
  onCommit: (value: T | null, option: ComboboxOption<T> | null) => void;
  placeholder?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  invalid?: boolean;
  invalidMessage?: string;
  suggested?: boolean;
  onAcceptSuggestion?: () => void;
  "aria-label"?: string;
  className?: string;
  inputRef?: (el: HTMLInputElement | null) => void;
  /** Pilot Review Board follow-up — "when the user completes a row, the
   * cursor should automatically move to the Type column of the next
   * row... no additional click." When provided, Tab commits as usual
   * but then calls this instead of letting native tab order continue —
   * lets a caller redirect past optional trailing fields (Notes, Set
   * Rule) straight to wherever "the next row starts." Omit for normal
   * native-tab-order behaviour. */
  onTabOut?: () => void;
};

function defaultSearchText(option: ComboboxOption<string | number>): string {
  return option.searchText ?? `${option.label} ${option.sublabel ?? ""}`;
}

const MAX_RESULTS = 50;

export function Combobox<T extends string | number>({
  value,
  options,
  onCommit,
  placeholder,
  disabled,
  autoFocus,
  invalid,
  invalidMessage,
  suggested,
  onAcceptSuggestion,
  "aria-label": ariaLabel,
  className,
  inputRef,
  onTabOut,
}: ComboboxProps<T>) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const listboxId = React.useId();

  const selectedOption = useMemo(() => options.find((o) => o.value === value) ?? null, [options, value]);
  const displayValue = open ? query : (selectedOption?.label ?? (value !== null ? String(value) : ""));

  const groupOrder = useMemo(() => {
    const order = new Map<string, number>();
    for (const o of options) {
      if (o.group !== undefined && !order.has(o.group)) order.set(o.group, order.size);
    }
    return order;
  }, [options]);

  const filtered = useMemo(() => {
    let results: ComboboxOption<T>[];
    if (!query.trim()) {
      results = options.slice(0, MAX_RESULTS);
    } else {
      const matched = fuzzysort.go(query, options as ComboboxOption<string | number>[], {
        key: (o: ComboboxOption<string | number>) => defaultSearchText(o),
        limit: MAX_RESULTS,
      });
      results = matched.map((r) => r.obj as ComboboxOption<T>);
    }
    if (groupOrder.size === 0) return results;
    // Stable sort — preserves fuzzysort's own relevance order within
    // each group, only reorders which group's block comes first.
    return [...results].sort((a, b) => (groupOrder.get(a.group ?? "") ?? Infinity) - (groupOrder.get(b.group ?? "") ?? Infinity));
  }, [query, options, groupOrder]);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [open]);

  function commit(option: ComboboxOption<T> | null) {
    onCommit(option?.value ?? null, option);
    setOpen(false);
    setQuery("");
  }

  function commitBestMatch() {
    if (filtered.length === 0) return;
    const q = query.trim().toLowerCase();
    // Exact match checks the option's label/value first, then falls back
    // to any individual whitespace-split token of its full search text —
    // this is what lets a short, unambiguous code commit immediately
    // (e.g. VAT "15" against searchText "Standard Rated 15", or a GL
    // code embedded alongside its description) without requiring the
    // user to arrow down to a highlighted option first.
    const exact = filtered.find((o) => {
      if (o.label.toLowerCase() === q || String(o.value).toLowerCase() === q) return true;
      return defaultSearchText(o).toLowerCase().split(/\s+/).includes(q);
    });
    commit(exact ?? filtered[highlightedIndex] ?? null);
  }

  function handleFocus() {
    setOpen(true);
    setQuery("");
    setHighlightedIndex(0);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      if (!open) return; // closed — let it bubble for row navigation
      e.preventDefault();
      e.stopPropagation();
      setHighlightedIndex((i) => Math.min(i + 1, filtered.length - 1));
      return;
    }
    if (e.key === "ArrowUp") {
      if (!open) return;
      e.preventDefault();
      e.stopPropagation();
      setHighlightedIndex((i) => Math.max(i - 1, 0));
      return;
    }
    if (e.key === "Escape") {
      if (!open) return;
      e.stopPropagation();
      setOpen(false);
      setQuery("");
      return;
    }
    if (e.key === "Enter") {
      if (open && filtered.length > 0) {
        e.preventDefault();
        commit(filtered[highlightedIndex] ?? null);
      }
      // Not stopped — lets a row-level "Enter moves down one row" handler
      // still see this event after the commit above has already run.
      return;
    }
    if (e.key === "Tab") {
      if (open && query.trim()) commitBestMatch();
      else setOpen(false);
      if (onTabOut) {
        e.preventDefault();
        onTabOut();
      }
      // Otherwise never prevented — native tab order continues to the next field.
    }
  }

  function handleBlur() {
    // Only ever commits a real option (see `commitBestMatch`) — typing
    // something that matches nothing just reverts the display back to
    // whatever was last actually selected, it never leaves garbage text
    // or an unresolved value stuck in the field.
    if (open && query.trim()) commitBestMatch();
    setOpen(false);
    setQuery("");
  }

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-label={ariaLabel}
        aria-autocomplete="list"
        autoFocus={autoFocus}
        disabled={disabled}
        placeholder={placeholder}
        value={displayValue}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setHighlightedIndex(0);
        }}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        className={cn(
          "w-full rounded-md border bg-transparent px-2 py-1.5 text-sm outline-none transition-colors",
          invalid ? "border-vf-danger/50 text-vf-danger focus:border-vf-danger" : "border-transparent focus:border-vf-red-500 focus:bg-vf-paper",
          suggested && !invalid && "border-vf-warning/40 bg-vf-warning/8 text-[#93601f]",
        )}
        title={invalid ? invalidMessage : undefined}
      />
      {suggested && !open && (
        <button
          type="button"
          tabIndex={-1}
          onClick={(e) => {
            e.stopPropagation();
            onAcceptSuggestion?.();
          }}
          className="absolute top-1/2 right-1 -translate-y-1/2 rounded bg-vf-warning/16 px-1.5 py-0.5 text-[10px] font-semibold text-[#93601f] hover:bg-vf-warning/25"
          title="Accept suggestion"
        >
          Accept
        </button>
      )}
      {open && (
        <ul
          id={listboxId}
          role="listbox"
          className="absolute top-full left-0 z-20 mt-1 max-h-64 w-max min-w-full overflow-y-auto rounded-vf-md border border-vf-paper-border bg-vf-paper py-1 shadow-vf-paper-lg"
        >
          {filtered.length === 0 ? (
            <li className="px-3 py-1.5 text-sm text-vf-ink-faint">No matches</li>
          ) : (
            (() => {
              let lastGroup: string | undefined;
              return filtered.map((option, index) => {
                const showHeader = option.group !== undefined && option.group !== lastGroup;
                lastGroup = option.group;
                return (
                  <li key={option.value} role="presentation">
                    {showHeader && (
                      <div className="border-t border-vf-paper-border px-3 pt-2 pb-1 text-[10px] font-semibold tracking-wide text-vf-ink-faint uppercase first:border-t-0">
                        {option.group}
                      </div>
                    )}
                    <div
                      role="option"
                      aria-selected={index === highlightedIndex}
                      onMouseDown={(e) => {
                        e.preventDefault(); // keep focus on the input through the click
                        commit(option);
                      }}
                      onMouseEnter={() => setHighlightedIndex(index)}
                      className={cn(
                        "flex cursor-pointer flex-col gap-0 px-3 py-1.5 text-sm whitespace-nowrap",
                        index === highlightedIndex ? "bg-vf-red-500/10 text-vf-ink" : "text-vf-ink-soft",
                      )}
                    >
                      <span>{option.label}</span>
                      {option.sublabel && <span className="text-xs text-vf-ink-faint">{option.sublabel}</span>}
                    </div>
                  </li>
                );
              });
            })()
          )}
        </ul>
      )}
    </div>
  );
}

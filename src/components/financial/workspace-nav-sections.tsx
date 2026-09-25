"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
import { IconChevronDown } from "@/components/ui/icons";
import { NAV_GROUPS, isNavItemActive, type NavGroup } from "./workspace-nav";

/**
 * Phase 5G — the grouped navigation body, rendered identically by the
 * desktop sidebar and the tablet/mobile drawer.
 *
 * The behaviour the requirement asked for:
 *   - each group is a collapsed heading until opened;
 *   - clicking a heading opens it, clicking the open one closes it;
 *   - opening one closes the other (the `openGroup` state is a single
 *     value, so this is structural rather than something to remember);
 *   - the group containing the open page is opened automatically (the
 *     shell derives that with `activeNavGroup`).
 *
 * Visual treatment follows the PRECISIA "Software Page" reference: blue
 * letter-spaced section labels, light item text, and a blue gradient
 * pill with a bright left edge on the current page.
 */
export function WorkspaceNavSections({
  companyId,
  pathname,
  openGroup,
  onToggleGroup,
  onNavigate,
  groups = NAV_GROUPS,
  idPrefix = "nav",
}: {
  companyId: string;
  pathname: string;
  openGroup: string | null;
  onToggleGroup: (label: string) => void;
  /** Called after a link is followed — the drawer uses it to close. */
  onNavigate?: () => void;
  groups?: NavGroup[];
  /** Keeps `aria-controls` ids unique when both copies are mounted. */
  idPrefix?: string;
}) {
  return (
    <>
      {groups.map((group) => {
        const expanded = openGroup === group.label;
        const panelId = `${idPrefix}-${group.label.toLowerCase().replace(/\s+/g, "-")}`;
        // A collapsed group still tells you the page you are on lives
        // inside it, so the nav never looks like nothing is selected.
        const containsActive = group.items.some((i) => isNavItemActive(pathname, companyId, i.href, i.exact));

        return (
          <div key={group.label}>
            <button
              type="button"
              onClick={() => onToggleGroup(group.label)}
              aria-expanded={expanded}
              aria-controls={panelId}
              className={cn(
                "flex w-full items-center gap-2 rounded-[10px] px-3 py-2 text-[0.68rem] font-semibold tracking-[0.14em] uppercase transition-colors duration-150 ease-vf-out",
                expanded || containsActive ? "text-[#2f8fe8]" : "text-[#6f8fb5]",
                "hover:bg-white/5 hover:text-[#5cb3ff]",
              )}
            >
              <IconChevronDown
                className={cn("h-3.5 w-3.5 shrink-0 transition-transform duration-200 ease-vf-out", expanded ? "rotate-0" : "-rotate-90")}
              />
              <span className="flex-1 text-left">{group.label}</span>
              {!expanded && containsActive && <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#2f9bff]" />}
            </button>

            {expanded && (
              <div id={panelId} className="mt-0.5 flex flex-col gap-0.5 pb-2">
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const active = isNavItemActive(pathname, companyId, item.href, item.exact);
                  const content = (
                    <>
                      <Icon className={cn("h-[18px] w-[18px] shrink-0", active ? "text-[#5cb3ff]" : "text-[#c9d4e3]")} />
                      {item.label}
                    </>
                  );
                  const itemClass = cn(
                    "flex items-center gap-3 rounded-r-[12px] py-[7px] pr-3 pl-6 text-[0.82rem] font-medium transition-[background-color,color] duration-150 ease-vf-out",
                    active ? "pc-nav-active" : "text-[#d5dde8] hover:bg-white/5 hover:text-white",
                  );

                  return item.href ? (
                    <Link
                      key={item.label}
                      href={`/company/${companyId}/${item.href}`}
                      className={itemClass}
                      aria-current={active ? "page" : undefined}
                      onClick={onNavigate}
                    >
                      {content}
                    </Link>
                  ) : (
                    // Finding #174 (RC-16/E12) — an inert item used to
                    // share the exact same class as a real, clickable
                    // (if inactive) nav link. Kept visibly dimmed, with
                    // no hover state and a "Soon" label.
                    <span
                      key={item.label}
                      className="flex cursor-not-allowed items-center gap-3 py-[7px] pr-3 pl-6 text-[0.82rem] font-medium text-white/30"
                      aria-disabled
                      title={`${item.label} — not available yet`}
                    >
                      {content}
                      <span className="ml-auto text-[0.6rem] tracking-wide uppercase">Soon</span>
                    </span>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

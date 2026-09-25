import type { SVGProps } from "react";

/**
 * Icons drawn in the PRECISIA reference images that the platform's base
 * set (`icons.tsx`) doesn't already have. Same construction as that set —
 * 24x24 viewBox, `currentColor` stroke — so the two mix freely.
 */
type IconProps = SVGProps<SVGSVGElement>;

const base = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export function PIconHome(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M3.5 10.5 12 3.5l8.5 7" />
      <path d="M5.5 9v11h13V9" />
      <path d="M10 20v-6h4v6" />
    </svg>
  );
}

export function PIconOperations(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M8.5 12a3.5 3.5 0 1 0 3.5-3.5" />
      <path d="M12 8.5V6.2M12 12l2.6-2.6" />
    </svg>
  );
}

export function PIconBilling(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M14.5 9.2c-.5-.8-1.4-1.2-2.5-1.2-1.4 0-2.5.7-2.5 1.9 0 2.6 5 1.4 5 4.1 0 1.2-1.1 2-2.5 2-1.2 0-2.2-.5-2.7-1.3M12 6.5V8M12 16v1.5" />
    </svg>
  );
}

export function PIconUpload(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M12 15V4M7.5 8.5 12 4l4.5 4.5" />
      <path d="M4 14.5V19a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4.5" />
    </svg>
  );
}

export function PIconDownload(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M12 4v11M7.5 10.5 12 15l4.5-4.5" />
      <path d="M4 14.5V19a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4.5" />
    </svg>
  );
}

export function PIconInvoice(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M14 3.5H7a1.5 1.5 0 0 0-1.5 1.5v14A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5V8L14 3.5Z" />
      <path d="M14 3.5V8h4.5M9 12.5h6M9 16h4" />
    </svg>
  );
}

export function PIconBill(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M14 3.5H7a1.5 1.5 0 0 0-1.5 1.5v14A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5V8L14 3.5Z" />
      <path d="M14 3.5V8h4.5" />
      <circle cx="12" cy="14" r="2.6" />
    </svg>
  );
}

export function PIconDatabase(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <ellipse cx="12" cy="6" rx="7" ry="2.6" />
      <path d="M5 6v4c0 1.4 3.1 2.6 7 2.6s7-1.2 7-2.6V6" />
      <path d="M5 10v4c0 1.4 3.1 2.6 7 2.6s7-1.2 7-2.6v-4" />
      <path d="M5 14v4c0 1.4 3.1 2.6 7 2.6s7-1.2 7-2.6v-4" />
    </svg>
  );
}

export function PIconSparkles(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M10 4.5 11.4 9a2 2 0 0 0 1.3 1.3l4.5 1.4-4.5 1.4a2 2 0 0 0-1.3 1.3L10 18.9 8.6 14.4a2 2 0 0 0-1.3-1.3L2.8 11.7l4.5-1.4A2 2 0 0 0 8.6 9L10 4.5Z" />
      <path d="M18 3v4M16 5h4M18.5 16v3M17 17.5h3" />
    </svg>
  );
}

export function PIconWallet(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M17 7V5.5A1.5 1.5 0 0 0 15.5 4h-10A2.5 2.5 0 0 0 3 6.5v11A2.5 2.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15" />
      <path d="M3 7h15.5A1.5 1.5 0 0 1 20 8.5V10" />
      <path d="M21 10h-4.5a2.5 2.5 0 0 0 0 5H21v-5Z" />
    </svg>
  );
}

export function PIconCart(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M3 4h2.4l2.2 10.2a1.5 1.5 0 0 0 1.5 1.2h8.4a1.5 1.5 0 0 0 1.5-1.1L21 7.5H6.2" />
      <circle cx="9.5" cy="19" r="1.4" />
      <circle cx="17" cy="19" r="1.4" />
    </svg>
  );
}

export function PIconBars(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="4" y="13" width="4" height="7" rx="1" />
      <rect x="10" y="9" width="4" height="11" rx="1" />
      <rect x="16" y="5" width="4" height="15" rx="1" />
    </svg>
  );
}

export function PIconPie(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M11 4.1A8 8 0 1 0 19.9 13H11V4.1Z" />
      <path d="M14 3.2V10h6.8A7 7 0 0 0 14 3.2Z" />
    </svg>
  );
}

export function PIconClock(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7v5l3.5 2" />
    </svg>
  );
}

export function PIconGear(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.8v2.4M12 18.8v2.4M4.9 4.9l1.7 1.7M17.4 17.4l1.7 1.7M2.8 12h2.4M18.8 12h2.4M4.9 19.1l1.7-1.7M17.4 6.6l1.7-1.7" />
      <circle cx="12" cy="12" r="6.2" />
    </svg>
  );
}

export function PIconShield(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M12 3 5 6v6c0 4.4 3 7.6 7 9 4-1.4 7-4.6 7-9V6l-7-3Z" />
    </svg>
  );
}

export function PIconBrain(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M12 5.5A3 3 0 0 0 6.5 5a3 3 0 0 0-2 4.6A3.2 3.2 0 0 0 5 15a3 3 0 0 0 2.5 3.6A2.8 2.8 0 0 0 12 19.5V5.5Z" />
      <path d="M12 5.5A3 3 0 0 1 17.5 5a3 3 0 0 1 2 4.6A3.2 3.2 0 0 1 19 15a3 3 0 0 1-2.5 3.6A2.8 2.8 0 0 1 12 19.5" />
      <path d="M9 9.5h1.5M8.5 13.5H10M13.5 9.5H15M14 13.5h1.5" />
    </svg>
  );
}

export function PIconTrendUp(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="3.5" y="15" width="3" height="5" rx="0.6" />
      <rect x="8.5" y="12" width="3" height="8" rx="0.6" />
      <rect x="13.5" y="13.5" width="3" height="6.5" rx="0.6" />
      <path d="M3.5 11 9 6.5l3.5 3L20 3.5M15.5 3.5H20V8" />
    </svg>
  );
}

export function PIconArrowRight(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

export function PIconChevronRight(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

export function PIconPlay(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" {...props}>
      <circle cx="12" cy="12" r="11" fill="#fff" />
      <path d="M10 8.2v7.6l6-3.8-6-3.8Z" fill="#1670ff" />
    </svg>
  );
}

export function PIconMail(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="3" y="5.5" width="18" height="13" rx="2" />
      <path d="m3.5 7 8.5 6 8.5-6" />
    </svg>
  );
}

export function PIconLock(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="5" y="10.5" width="14" height="10" rx="2" />
      <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3M12 14.5v2.5" />
    </svg>
  );
}

export function PIconBuildingColumns(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M3 9.5 12 4l9 5.5H3Z" />
      <path d="M5.5 10v7M9.8 10v7M14.2 10v7M18.5 10v7M3 20h18M4 17.5h16" />
    </svg>
  );
}

export function PIconOffice(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M4 20.5V5a1.5 1.5 0 0 1 1.5-1.5h8A1.5 1.5 0 0 1 15 5v15.5M15 9.5h3.5A1.5 1.5 0 0 1 20 11v9.5M2.5 20.5h19" />
      <path d="M7.5 7.5h1M11 7.5h1M7.5 11h1M11 11h1M7.5 14.5h1M11 14.5h1M10 20.5v-2.5" />
    </svg>
  );
}

export function PIconUserPlus(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="9.5" cy="8" r="3.5" />
      <path d="M3 20c0-3.6 2.9-6 6.5-6 1.6 0 3 .5 4.1 1.3M18 13v6M15 16h6" />
    </svg>
  );
}

export function PIconUsers(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6" />
      <path d="M15.5 4.8a3.5 3.5 0 0 1 0 6.4M17.5 14.3c2.3.7 4 2.8 4 5.7" />
    </svg>
  );
}

export function PIconSliders(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
      <circle cx="15" cy="7" r="2" />
      <circle cx="9" cy="17" r="2" />
      <path d="M12 12h8M4 12h4" />
    </svg>
  );
}

export function PIconCheckCircle(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" {...props}>
      <circle cx="12" cy="12" r="10" fill="currentColor" />
      <path d="m7.5 12.2 3 3 6-6.2" fill="none" stroke="#04140b" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function PIconDots(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <circle cx="12" cy="5.5" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="12" cy="18.5" r="1.6" />
    </svg>
  );
}

export function PIconGrowth(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M12 3.5 14 6l3-.4.6 3 2.7 1.5-1.2 2.8 1.2 2.8-2.7 1.5-.6 3-3-.4-2 2.5-2-2.5-3 .4-.6-3-2.7-1.5L4.9 12 3.7 9.1l2.7-1.5.6-3 3 .4 2-2.5Z" />
      <path d="m9 13 2 2 4-4.5" />
    </svg>
  );
}

export function PIconBadgeInfo(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M12 3.5 14 6l3-.4.6 3 2.7 1.5-1.2 2.8 1.2 2.8-2.7 1.5-.6 3-3-.4-2 2.5-2-2.5-3 .4-.6-3-2.7-1.5L4.9 12 3.7 9.1l2.7-1.5.6-3 3 .4 2-2.5Z" />
      <path d="M12 8.5v4.5M12 15.5h.01" />
    </svg>
  );
}

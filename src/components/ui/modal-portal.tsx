"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";

const subscribeNothing = () => () => {};

/**
 * Renders a full-screen overlay as a direct child of `<body>` instead of
 * wherever it happens to sit in the React tree.
 *
 * Why this exists — production defect "invoice modal jumps when the
 * mouse moves toward the right of the screen": every `position: fixed`
 * overlay in this app was rendered *inside* the page's paper `<Card>`,
 * and `Card` answers hover with `hover:-translate-y-0.5`. Per the CSS
 * spec, an ancestor whose `transform`/`translate`/`filter` is not `none`
 * becomes the containing block for its fixed-position descendants — so
 * the instant the Card became `:hover` (which it always does while the
 * pointer is over any DOM descendant, the overlay included), the
 * "full-screen" overlay re-anchored to the Card's box. The pointer was
 * then outside the shrunken overlay, the Card lost `:hover`, the
 * overlay snapped back to the viewport, the Card was hovered again — a
 * layout feedback loop, reproduced in a real browser. Portaling to
 * `<body>` removes every page ancestor from the overlay's DOM ancestry,
 * so no ancestor's hover/transform/filter can ever capture it again.
 *
 * Hydration-safe: the server snapshot is `false`, so SSR (and the
 * hydration pass that must match it) render the children inline — this
 * matters for the server-rendered PDF views, which render these same
 * document overlays. Any client-side mount (every "View" click) gets
 * `true` on its first render, so the overlay is never painted in the
 * wrong place even for a frame.
 */
export function ModalPortal({ children }: { children: ReactNode }) {
  const isClient = useSyncExternalStore(
    subscribeNothing,
    () => true,
    () => false,
  );
  if (!isClient) return <>{children}</>;
  return createPortal(children, document.body);
}

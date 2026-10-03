import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { axe } from "jest-axe";
import { SiteFooter } from "./site-footer";

const ECOSYSTEM: [name: string, descriptor: string, href: string][] = [
  ["VOLORA™", "Cost Intelligence", "https://www.volora.co.za/"],
  ["UMORA™", "Human & Workforce Intelligence", "https://www.umora.co.za/"],
  ["LAVORARE™", "Workforce & Payroll Intelligence", "https://www.lavorare.co.za/"],
  ["SAFENZA™", "Safety Intelligence", "https://www.safenza.co.za/"],
  ["PROVENA™", "Sustainability & Compliance Intelligence", "https://www.provena.co.za/"],
  ["PRECISIA™", "Finance Intelligence", "https://www.precisia.co.za/"],
];

describe("SiteFooter — VYRONSOFT software ecosystem", () => {
  it("links all six products, in order, by name, to their production sites", () => {
    render(<SiteFooter />);
    const nav = screen.getByRole("navigation", { name: "VYRONSOFT Software Ecosystem" });
    const links = within(nav).getAllByRole("link");
    expect(links.map((a) => [a.textContent, a.getAttribute("href")])).toEqual(ECOSYSTEM.map(([name, , href]) => [name, href]));
    for (const [name, descriptor] of ECOSYSTEM) {
      expect(screen.getByRole("link", { name }).closest("li")).toHaveTextContent(`${name}${descriptor}`);
    }
  });

  it("links VYRONSOFT (Pty) Ltd and carries the corporate statement and copyright", () => {
    render(<SiteFooter />);
    expect(screen.getByRole("link", { name: "VYRONSOFT (Pty) Ltd" })).toHaveAttribute("href", "https://www.vyronsoft.co.za/");
    expect(screen.getByText("BUSINESS INTELLIGENCE FOR A STRONGER TOMORROW.")).toBeInTheDocument();
    expect(screen.getByText(`© ${new Date().getFullYear()} VYRONSOFT (Pty) Ltd. All rights reserved.`)).toBeInTheDocument();
  });

  it("uses plain same-tab links to public https URLs only", () => {
    const { container } = render(<SiteFooter />);
    for (const a of container.querySelectorAll("a")) {
      expect(a).toHaveAttribute("href");
      expect(a).not.toHaveAttribute("target");
      expect(a).not.toHaveAttribute("onclick");
      expect(a.getAttribute("href")).not.toMatch(/vercel|localhost|127\.0\.0\.1/i);
      if (!a.getAttribute("href")!.startsWith("/")) expect(a.getAttribute("href")).toMatch(/^https:\/\/www\.[a-z]+\.co\.za\/$/);
    }
  });

  it("never uses VYRON alone as the corporate identity", () => {
    const { container } = render(<SiteFooter />);
    expect(container.textContent).not.toMatch(/\bVYRON\b|Vyronsoft|Precisia\. All rights/);
  });

  it("keeps the existing Product and Company links", () => {
    render(<SiteFooter />);
    for (const name of ["Platform", "Features", "Pricing", "How It Works", "About", "Resources", "Contact", "Request a Demo"]) {
      expect(screen.getByRole("link", { name })).toBeInTheDocument();
    }
  });

  it("has no accessibility violations", async () => {
    const { container } = render(<SiteFooter />);
    expect(await axe(container)).toHaveNoViolations();
  });
});

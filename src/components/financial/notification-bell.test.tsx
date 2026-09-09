import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { axe } from "jest-axe";
import { NotificationBell } from "./notification-bell";
import { MOCK_NOTIFICATIONS } from "@/lib/mock/automation-data";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh: vi.fn() }),
}));

describe("NotificationBell", () => {
  beforeEach(() => {
    push.mockClear();
  });

  it("shows the unread count badge from Preview Mode sample data", () => {
    render(<NotificationBell companyId="co_1" previewMode />);
    const unread = MOCK_NOTIFICATIONS.filter((n) => !n.isRead).length;
    expect(screen.getByRole("button", { name: new RegExp(`${unread} unread`) })).toBeInTheDocument();
  });

  it("opens the dropdown and lists notifications on click", () => {
    render(<NotificationBell companyId="co_1" previewMode />);
    fireEvent.click(screen.getByRole("button", { name: /notifications/i }));
    expect(screen.getByRole("dialog", { name: "Notifications" })).toBeInTheDocument();
    expect(screen.getByText(MOCK_NOTIFICATIONS[0].title)).toBeInTheDocument();
  });

  it("disables Mark all read in Preview Mode", () => {
    render(<NotificationBell companyId="co_1" previewMode />);
    fireEvent.click(screen.getByRole("button", { name: /notifications/i }));
    expect(screen.getByRole("button", { name: /mark all read/i })).toBeDisabled();
  });

  it("has no obvious accessibility violations", async () => {
    const { container } = render(<NotificationBell companyId="co_1" previewMode />);
    fireEvent.click(screen.getByRole("button", { name: /notifications/i }));
    expect(await axe(container)).toHaveNoViolations();
  });

  it("navigates to the related screen when a recognized notification row is clicked", () => {
    render(<NotificationBell companyId="co_1" previewMode />);
    fireEvent.click(screen.getByRole("button", { name: /notifications/i }));
    // MOCK_NOTIFICATIONS[0] has relatedType "RecurringTemplate".
    fireEvent.click(screen.getByText(MOCK_NOTIFICATIONS[0].title));
    expect(push).toHaveBeenCalledWith("/company/co_1/recurring-templates");
  });

  it("does not navigate for a notification with an unrecognized relatedType", () => {
    render(<NotificationBell companyId="co_1" previewMode />);
    fireEvent.click(screen.getByRole("button", { name: /notifications/i }));
    // MOCK_NOTIFICATIONS[2] has relatedType "Customer", not in the map.
    fireEvent.click(screen.getByText(MOCK_NOTIFICATIONS[2].title));
    expect(push).not.toHaveBeenCalled();
  });
});

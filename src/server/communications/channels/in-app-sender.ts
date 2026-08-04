/**
 * The InApp channel's real delivery target — the SAME `notifications`
 * table the Notification Centre already reads (0014_automation_platform.sql).
 * No second notification store: an InApp communication's "send" step
 * is simply "create a notification row," so the existing Notification
 * Bell surfaces it with zero UI changes.
 */

import * as notificationRepo from "@/server/repositories/notification-repository";
import type { CommunicationRecipient } from "../types";

export type InAppDeliveryResult = { notificationId: number };

function recipientLabel(recipients: CommunicationRecipient[]): string {
  if (recipients.length === 0) return "Company-wide";
  if (recipients.length === 1) return recipients[0].name;
  return `${recipients[0].name} +${recipients.length - 1} more`;
}

export async function deliverInApp(
  companyId: string,
  recipients: CommunicationRecipient[],
  subject: string | null,
  body: string,
  relatedType: string | null,
  relatedId: number | null,
): Promise<InAppDeliveryResult> {
  const notification = await notificationRepo.createNotification(companyId, {
    recipient: recipientLabel(recipients),
    notificationType: "TaskAssignment",
    title: subject ?? body.slice(0, 120),
    message: body,
    severity: "info",
    relatedType,
    relatedId,
  });
  return { notificationId: notification.id };
}

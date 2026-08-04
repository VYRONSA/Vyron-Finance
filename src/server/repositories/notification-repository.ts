/**
 * Repository layer for the Notification Centre — real, in-app.
 * `email_status` stays 'NotSent' everywhere in this codebase since no
 * email provider is connected (see `notifications` table comment in
 * `0014_automation_platform.sql`).
 */

import { createClient } from "@/lib/supabase/server";
import { notificationFromRow, type NotificationRow } from "@/server/automation/mappers";
import type { AppNotification, NotificationSeverity, NotificationType } from "@/server/automation/types";

export async function listNotifications(companyId: string, unreadOnly = false, limit = 50): Promise<AppNotification[]> {
  const supabase = await createClient();
  let query = supabase.from("notifications").select("*").eq("company_id", companyId);
  if (unreadOnly) query = query.eq("is_read", false);
  const { data, error } = await query.order("created_at", { ascending: false }).limit(limit).returns<NotificationRow[]>();
  if (error) throw error;
  return data.map(notificationFromRow);
}

export async function countUnreadNotifications(companyId: string): Promise<number> {
  const supabase = await createClient();
  const { count, error } = await supabase.from("notifications").select("*", { count: "exact", head: true }).eq("company_id", companyId).eq("is_read", false);
  if (error) throw error;
  return count ?? 0;
}

export type NewNotification = {
  recipient?: string;
  notificationType: NotificationType;
  title: string;
  message?: string;
  severity?: NotificationSeverity;
  relatedType?: string | null;
  relatedId?: number | null;
};

export async function createNotification(companyId: string, input: NewNotification): Promise<AppNotification> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("notifications")
    .insert({
      company_id: companyId,
      recipient: input.recipient ?? "Company-wide",
      notification_type: input.notificationType,
      title: input.title,
      message: input.message ?? "",
      severity: input.severity ?? "info",
      related_type: input.relatedType ?? null,
      related_id: input.relatedId ?? null,
    })
    .select("*")
    .single<NotificationRow>();
  if (error) throw error;
  return notificationFromRow(data);
}

export async function markNotificationRead(companyId: string, notificationId: number): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from("notifications").update({ is_read: true }).eq("company_id", companyId).eq("id", notificationId);
  if (error) throw error;
}

export async function markAllNotificationsRead(companyId: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from("notifications").update({ is_read: true }).eq("company_id", companyId).eq("is_read", false);
  if (error) throw error;
}

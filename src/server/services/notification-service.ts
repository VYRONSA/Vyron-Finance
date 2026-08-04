/**
 * Service layer for the Notification Centre.
 */

import * as repo from "@/server/repositories/notification-repository";

export const listNotifications = repo.listNotifications;
export const countUnreadNotifications = repo.countUnreadNotifications;
export const createNotification = repo.createNotification;
export const markNotificationRead = repo.markNotificationRead;
export const markAllNotificationsRead = repo.markAllNotificationsRead;

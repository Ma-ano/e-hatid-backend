import { NotificationModel, type Notification } from "../models/notification.js";

export type NotificationRecipient = {
  userId?: string | null;
  vendorId?: string | null;
  riderId?: string | null;
};

export async function pushNotification(
  recipient: NotificationRecipient,
  message: string,
  type: Notification["type"] = "info",
  orderId?: string,
  link?: string,
): Promise<void> {
  await NotificationModel.create({
    userId: recipient.userId ?? null,
    vendorId: recipient.vendorId ?? null,
    riderId: recipient.riderId ?? null,
    message,
    type,
    read: false,
    orderId: orderId ?? null,
    link: link ?? "",
  });
}

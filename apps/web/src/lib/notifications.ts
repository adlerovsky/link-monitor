import "server-only";
import { prisma } from "@/lib/prisma";

const MAX_CHAT_ID_LENGTH = 120;

export async function getNotificationSnapshot(organizationId: string) {
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: {
      id: true,
      telegramChatId: true,
    },
  });

  if (!organization) return null;

  const [unreadAlerts, openAlerts, recentAlerts] = await Promise.all([
    prisma.alert.count({
      where: {
        readAt: null,
        backlink: {
          project: {
            organizationId,
          },
        },
      },
    }),
    prisma.alert.count({
      where: {
        resolvedAt: null,
        backlink: {
          project: {
            organizationId,
          },
        },
      },
    }),
    prisma.alert.findMany({
      where: {
        backlink: {
          project: {
            organizationId,
          },
        },
      },
      orderBy: {
        triggeredAt: "desc",
      },
      take: 5,
      select: {
        id: true,
        type: true,
        triggeredAt: true,
        resolvedAt: true,
        readAt: true,
        backlink: {
          select: {
            sourceUrl: true,
            targetUrl: true,
            status: true,
          },
        },
      },
    }),
  ]);

  return {
    channels: {
      telegram: {
        enabled: Boolean(organization.telegramChatId),
        chatId: organization.telegramChatId,
      },
    },
    stats: {
      unreadAlerts,
      openAlerts,
    },
    recentAlerts,
  };
}

export async function updateTelegramChatId(organizationId: string, chatIdRaw: unknown) {
  const chatId = typeof chatIdRaw === "string" ? chatIdRaw.trim() : "";
  const nextChatId = chatId.length > 0 ? chatId : null;

  if (nextChatId && nextChatId.length > MAX_CHAT_ID_LENGTH) {
    return {
      ok: false,
      status: 400,
      error: "telegramChatId is too long",
      code: "INVALID_TELEGRAM_CHAT_ID",
    } as const;
  }

  const updated = await prisma.organization.update({
    where: { id: organizationId },
    data: {
      telegramChatId: nextChatId,
    },
    select: { id: true },
  });

  return {
    ok: true,
    status: 200,
    organizationId: updated.id,
  } as const;
}

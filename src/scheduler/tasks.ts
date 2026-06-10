import cron from "node-cron";
import { AppDataSource } from "../config/database";
import { Event } from "../entities/Event";
import { Notification } from "../entities/Notification";
import { EVENT_STATUS } from "../config";
import dayjs from "dayjs";

export async function checkOverdueTasks() {
  try {
    const eventRepo = AppDataSource.getRepository(Event);
    const notifRepo = AppDataSource.getRepository(Notification);

    const now = new Date();
    const activeStatuses = [
      EVENT_STATUS.PENDING,
      EVENT_STATUS.ASSIGNED,
      EVENT_STATUS.PROCESSING,
      EVENT_STATUS.FEEDBACK,
      EVENT_STATUS.REVISITING,
    ];

    const overdueEvents = await eventRepo
      .createQueryBuilder("e")
      .where("e.status IN (:...statuses)", { statuses: activeStatuses })
      .andWhere("e.deadline IS NOT NULL")
      .andWhere("e.deadline < :now", { now })
      .andWhere("e.isOverdue = :f", { f: false })
      .getMany();

    for (const event of overdueEvents) {
      event.isOverdue = true;
      const prevStatus = event.status;
      event.status = EVENT_STATUS.OVERDUE;
      await eventRepo.save(event);

      const handlerId = event.assigneeId;
      if (handlerId) {
        const existingNotif = await notifRepo.findOne({
          where: {
            eventId: event.id,
            type: "overdue",
            userId: handlerId,
          },
        });
        if (!existingNotif) {
          const notif = notifRepo.create({
            userId: handlerId,
            type: "overdue",
            title: "Task overdue alert",
            content: `Event "${event.title}" (${event.eventNo}) has exceeded the deadline. Please handle it as soon as possible.`,
            eventId: event.id,
            isRead: false,
          });
          await notifRepo.save(notif);
        }
      }

      console.log(`[Overdue Check] Event ${event.eventNo} marked as overdue (was ${prevStatus})`);
    }

    if (overdueEvents.length > 0) {
      console.log(`[Overdue Check] Processed ${overdueEvents.length} overdue events`);
    }
  } catch (err) {
    console.error("[Overdue Check] Failed:", err);
  }
}

export async function checkDeadlineApproaching() {
  try {
    const eventRepo = AppDataSource.getRepository(Event);
    const notifRepo = AppDataSource.getRepository(Notification);

    const now = new Date();
    const warningTime = dayjs().add(2, "hour").toDate();
    const activeStatuses = [EVENT_STATUS.ASSIGNED, EVENT_STATUS.PROCESSING];

    const warningEvents = await eventRepo
      .createQueryBuilder("e")
      .where("e.status IN (:...statuses)", { statuses: activeStatuses })
      .andWhere("e.deadline IS NOT NULL")
      .andWhere("e.deadline > :now", { now })
      .andWhere("e.deadline <= :warning", { warning: warningTime })
      .andWhere("e.isOverdue = :f", { f: false })
      .getMany();

    for (const event of warningEvents) {
      const handlerId = event.assigneeId;
      if (handlerId) {
        const existingNotif = await notifRepo.findOne({
          where: {
            eventId: event.id,
            type: "deadline_approaching",
            userId: handlerId,
          },
        });
        if (!existingNotif) {
          const notif = notifRepo.create({
            userId: handlerId,
            type: "deadline_approaching",
            title: "Deadline approaching",
            content: `Event "${event.title}" (${event.eventNo}) will be due within 2 hours. Please hurry up.`,
            eventId: event.id,
            isRead: false,
          });
          await notifRepo.save(notif);
        }
      }
    }

    if (warningEvents.length > 0) {
      console.log(`[Deadline Approaching] Sent ${warningEvents.length} reminder notifications`);
    }
  } catch (err) {
    console.error("[Deadline Approaching Check] Failed:", err);
  }
}

export function startScheduledTasks() {
  cron.schedule("*/5 * * * *", () => {
    checkOverdueTasks();
  });

  cron.schedule("*/10 * * * *", () => {
    checkDeadlineApproaching();
  });

  console.log("[定时任务] 已启动：超时检查(每5分钟)、临期提醒(每10分钟)");
}

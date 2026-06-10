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
      if (event.status !== EVENT_STATUS.COMPLETED && event.status !== EVENT_STATUS.CLOSED) {
        event.status = EVENT_STATUS.OVERDUE;
      }
      await eventRepo.save(event);

      if (event.assignedToId) {
        const existingNotif = await notifRepo.findOne({
          where: {
            eventId: event.id,
            type: "event_overdue",
            userId: event.assignedToId,
          },
        });
        if (!existingNotif) {
          const notif = notifRepo.create({
            userId: event.assignedToId,
            type: "event_overdue",
            title: "任务超时提醒",
            content: `事件《${event.title}》（${event.eventNo}）已超过处置期限，请尽快处理！`,
            eventId: event.id,
          });
          await notifRepo.save(notif);
        }
      }

      console.log(`[超时检查] 事件 ${event.eventNo} 已标记为超时`);
    }

    if (overdueEvents.length > 0) {
      console.log(`[超时检查] 共处理 ${overdueEvents.length} 个超时事件`);
    }
  } catch (err) {
    console.error("[超时检查] 执行失败:", err);
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
      if (event.assignedToId) {
        const existingNotif = await notifRepo.findOne({
          where: {
            eventId: event.id,
            type: "event_overdue",
            userId: event.assignedToId,
            isRead: false,
          },
        });
        if (!existingNotif) {
          const notif = notifRepo.create({
            userId: event.assignedToId,
            type: "event_overdue",
            title: "任务即将超时提醒",
            content: `事件《${event.title}》（${event.eventNo}）将在2小时内到期，请抓紧处理！`,
            eventId: event.id,
          });
          await notifRepo.save(notif);
        }
      }
    }

    if (warningEvents.length > 0) {
      console.log(`[即将到期] 共发送 ${warningEvents.length} 条提醒通知`);
    }
  } catch (err) {
    console.error("[即将到期检查] 执行失败:", err);
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

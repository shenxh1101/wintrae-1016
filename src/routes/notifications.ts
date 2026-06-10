import { Router, Request, Response, NextFunction } from "express";
import { AppDataSource } from "../config/database";
import { Notification } from "../entities/Notification";
import { success, AppError } from "../utils/response";
import { authMiddleware } from "../middlewares/auth";

const router = Router();

router.get("/", authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { page = 1, pageSize = 20, isRead, type } = req.query;
    const notifRepo = AppDataSource.getRepository(Notification);

    let queryBuilder = notifRepo.createQueryBuilder("n")
      .leftJoinAndSelect("n.event", "e")
      .where("n.userId = :uid", { uid: req.user!.userId });

    if (isRead !== undefined && isRead !== null) {
      const read = String(isRead) === "true";
      queryBuilder = queryBuilder.andWhere("n.isRead = :ir", { ir: read });
    }

    if (type) {
      queryBuilder = queryBuilder.andWhere("n.type = :type", { type });
    }

    const total = await queryBuilder.getCount();
    const notifications = await queryBuilder
      .skip((Number(page) - 1) * Number(pageSize))
      .take(Number(pageSize))
      .orderBy("n.createdAt", "DESC")
      .getMany();

    success(res, notifications, "Notifications retrieved successfully", {
      total,
      page: Number(page),
      pageSize: Number(pageSize),
    });
  } catch (err) {
    next(err);
  }
});

router.get("/unread-count", authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const notifRepo = AppDataSource.getRepository(Notification);
    const allUnread = await notifRepo.find({
      where: {
        userId: req.user!.userId,
        isRead: false,
      },
    });

    const byType: Record<string, number> = {
      urge: 0,
      overdue: 0,
      deadline_approaching: 0,
      system: 0,
      other: 0,
    };
    for (const n of allUnread as any[]) {
      const t = n.type || "other";
      if (byType.hasOwnProperty(t)) {
        byType[t]++;
      } else {
        byType.other++;
      }
    }

    success(res, {
      total: allUnread.length,
      byType,
      urge: byType.urge,
      overdue: byType.overdue,
      deadlineApproaching: byType.deadline_approaching,
      system: byType.system,
      count: allUnread.length,
    }, "Unread count retrieved successfully");
  } catch (err) {
    next(err);
  }
});

router.get("/:id", authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const notifRepo = AppDataSource.getRepository(Notification);
    const notification = await notifRepo.findOne({
      where: { id: req.params.id },
      relations: ["event"],
    });

    if (!notification) {
      throw new AppError("Notification not found", 404, 404);
    }

    if (notification.userId !== req.user!.userId) {
      throw new AppError("No permission to view this notification", 403, 403);
    }

    success(res, notification, "Notification retrieved successfully");
  } catch (err) {
    next(err);
  }
});

router.post("/:id/read", authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const notifRepo = AppDataSource.getRepository(Notification);
    const notification = await notifRepo.findOne({ where: { id: req.params.id } });

    if (!notification) {
      throw new AppError("Notification not found", 404, 404);
    }

    if (notification.userId !== req.user!.userId) {
      throw new AppError("No permission to modify this notification", 403, 403);
    }

    notification.isRead = true;
    notification.readAt = new Date();
    await notifRepo.save(notification);

    success(res, notification, "Notification marked as read successfully");
  } catch (err) {
    next(err);
  }
});

router.post("/read-all", authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const notifRepo = AppDataSource.getRepository(Notification);
    const type = req.body && req.body.type ? req.body.type : undefined;
    const ids = req.body && Array.isArray(req.body.ids) ? req.body.ids : undefined;

    let where: any = { userId: req.user!.userId, isRead: false };
    if (type) where.type = type;

    let notifications = await notifRepo.find({ where });
    if (ids) {
      notifications = notifications.filter((n: any) => ids.includes(n.id));
    }

    const now = new Date();
    for (const n of notifications) {
      n.isRead = true;
      n.readAt = now;
    }
    await notifRepo.save(notifications);

    success(res, {
      count: notifications.length,
      type: type || "all",
    }, "Notifications marked as read successfully");
  } catch (err) {
    next(err);
  }
});

router.delete("/:id", authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const notifRepo = AppDataSource.getRepository(Notification);
    const notification = await notifRepo.findOne({ where: { id: req.params.id } });

    if (!notification) {
      throw new AppError("Notification not found", 404, 404);
    }

    if (notification.userId !== req.user!.userId) {
      throw new AppError("No permission to delete this notification", 403, 403);
    }

    await notifRepo.remove(notification);

    success(res, null, "Notification deleted successfully");
  } catch (err) {
    next(err);
  }
});

export default router;

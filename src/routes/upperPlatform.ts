import { Router, Request, Response, NextFunction } from "express";
import z from "zod";
import { v4 as uuidv4 } from "uuid";
import dayjs from "dayjs";
import { AppDataSource } from "../config/database";
import { Event } from "../entities/Event";
import { EventFlow } from "../entities/EventFlow";
import { Notification } from "../entities/Notification";
import { User } from "../entities/User";
import { success, AppError } from "../utils/response";
import { authMiddleware, requireRoles } from "../middlewares/auth";
import { ROLES, EVENT_STATUS, EVENT_TYPES } from "../config";

const router = Router();

function generateEventNo(): string {
  const now = dayjs();
  const random = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `UPPER-EVT${now.format("YYYYMMDDHHmmss")}${random}`;
}

const upperPlatformEventSchema = z.object({
  title: z.string().min(1, "Title is required"),
  description: z.string().min(1, "Description is required"),
  eventType: z.enum([...EVENT_TYPES] as any),
  sourcePlatform: z.string().min(1, "Source platform is required"),
  sourceEventNo: z.string().optional(),
  communityId: z.string().optional(),
  gridAreaId: z.string().optional(),
  longitude: z.number().optional(),
  latitude: z.number().optional(),
  locationAddress: z.string().optional(),
  reporterName: z.string().optional(),
  reporterPhone: z.string().optional(),
  deadline: z.string().optional(),
  priority: z.number().optional(),
  callbackUrl: z.string().optional(),
  extraData: z.any().optional(),
});

const callbackAckSchema = z.object({
  success: z.boolean(),
  message: z.string().optional(),
});

async function addEventFlow(
  eventId: string,
  action: string,
  fromStatus: string | undefined,
  toStatus: string | undefined,
  operatorId: string | undefined,
  operatorName: string | undefined,
  remark?: string
) {
  const flowRepo = AppDataSource.getRepository(EventFlow);
  const flow = flowRepo.create({
    eventId,
    action,
    fromStatus,
    toStatus,
    operatorId,
    operatorName,
    remark,
  });
  await flowRepo.save(flow);
}

router.post("/events", authMiddleware, requireRoles(ROLES.UPPER_PLATFORM, ROLES.ADMIN), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = upperPlatformEventSchema.parse(req.body);
    const eventRepo = AppDataSource.getRepository(Event);
    const notifRepo = AppDataSource.getRepository(Notification);

    const eventNo = generateEventNo();
    const event = eventRepo.create({
      title: data.title,
      description: data.description,
      eventType: data.eventType,
      eventNo,
      status: EVENT_STATUS.PENDING,
      reporterId: req.user!.userId,
      reporterName: data.reporterName || req.user!.realName,
      reporterPhone: data.reporterPhone,
      reportedFrom: data.sourcePlatform,
      communityId: data.communityId,
      gridAreaId: data.gridAreaId,
      longitude: data.longitude,
      latitude: data.latitude,
      locationAddress: data.locationAddress,
      isOverdue: false,
      isRepeated: false,
      isRevisitConfirmed: false,
      priority: data.priority || 1,
      deadline: data.deadline ? new Date(data.deadline) : undefined,
      remark: data.sourceEventNo ? `[Upper Platform] Source: ${data.sourcePlatform}, Source Event No: ${data.sourceEventNo}` : `[Upper Platform] Source: ${data.sourcePlatform}`,
    });
    await eventRepo.save(event);

    await addEventFlow(
      event.id,
      "upper_create",
      undefined,
      EVENT_STATUS.PENDING,
      req.user!.userId,
      `${req.user!.realName} (${data.sourcePlatform})`,
      `Event synced from upper platform${data.sourceEventNo ? `, source event no: ${data.sourceEventNo}` : ""}`
    );

    const streetUsers = await AppDataSource.getRepository(User).find({
      where: { role: ROLES.STREET, isActive: true },
    });
    for (const u of streetUsers) {
      const notif = notifRepo.create({
        userId: u.id,
        type: "event_new",
        title: "New event from upper platform",
        content: `Event from upper platform (${data.sourcePlatform}): ${event.title} (${event.eventNo}), please assign it promptly.`,
        eventId: event.id,
        isRead: false,
      });
      await notifRepo.save(notif);
    }

    success(res, {
      id: event.id,
      eventNo: event.eventNo,
      status: event.status,
      createdAt: event.createdAt,
      sourcePlatform: data.sourcePlatform,
      sourceEventNo: data.sourceEventNo,
    }, "Event synced successfully");
  } catch (err) {
    next(err);
  }
});

router.get("/events", authMiddleware, requireRoles(ROLES.UPPER_PLATFORM, ROLES.ADMIN, ROLES.STREET), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const {
      page = 1,
      pageSize = 10,
      status,
      eventType,
      startDate,
      endDate,
      sourcePlatform,
      communityId,
      gridWorkerId,
      gridAreaId,
      isOverdue,
      isRepeated,
    } = req.query;

    const eventRepo = AppDataSource.getRepository(Event);

    let queryBuilder = eventRepo.createQueryBuilder("e")
      .leftJoinAndSelect("e.community", "c")
      .leftJoinAndSelect("e.gridArea", "g");

    if (status) {
      queryBuilder = queryBuilder.andWhere("e.status = :status", { status });
    }

    if (eventType) {
      queryBuilder = queryBuilder.andWhere("e.eventType = :et", { et: eventType });
    }

    if (sourcePlatform) {
      queryBuilder = queryBuilder.andWhere("e.reportedFrom = :sp", { sp: sourcePlatform });
    }

    if (communityId) {
      queryBuilder = queryBuilder.andWhere("e.communityId = :cid", { cid: communityId });
    }

    if (gridAreaId) {
      queryBuilder = queryBuilder.andWhere("e.gridAreaId = :gid", { gid: gridAreaId });
    }

    if (gridWorkerId) {
      queryBuilder = queryBuilder.andWhere(
        "(e.reporterId = :gwid OR e.assigneeId = :gwid)",
        { gwid: gridWorkerId }
      );
    }

    if (isOverdue !== undefined && isOverdue !== null) {
      const overdue = String(isOverdue) === "true";
      queryBuilder = queryBuilder.andWhere("e.isOverdue = :io", { io: overdue });
    }

    if (isRepeated !== undefined && isRepeated !== null) {
      const repeated = String(isRepeated) === "true";
      queryBuilder = queryBuilder.andWhere("e.isRepeated = :ir", { ir: repeated });
    }

    if (startDate) {
      queryBuilder = queryBuilder.andWhere("e.createdAt >= :sd", { sd: new Date(startDate as string) });
    }

    if (endDate) {
      queryBuilder = queryBuilder.andWhere("e.createdAt <= :ed", { ed: new Date(endDate as string) });
    }

    const total = await queryBuilder.getCount();
    const events = await queryBuilder
      .skip((Number(page) - 1) * Number(pageSize))
      .take(Number(pageSize))
      .orderBy("e.createdAt", "DESC")
      .getMany();

    success(res, events, "Upper platform events retrieved successfully", {
      total,
      page: Number(page),
      pageSize: Number(pageSize),
    });
  } catch (err) {
    next(err);
  }
});

router.get("/events/:id", authMiddleware, requireRoles(ROLES.UPPER_PLATFORM, ROLES.ADMIN, ROLES.STREET), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const eventRepo = AppDataSource.getRepository(Event);
    const flowRepo = AppDataSource.getRepository(EventFlow);

    const event = await eventRepo.findOne({
      where: { id: req.params.id },
      relations: ["community", "gridArea", "assignee"],
    });

    if (!event) {
      throw new AppError("Event not found", 404, 404);
    }

    const flows = await flowRepo.find({
      where: { eventId: req.params.id },
      order: { createdAt: "ASC" },
    });

    success(res, { ...event, flows }, "Event details retrieved successfully");
  } catch (err) {
    next(err);
  }
});

router.post("/events/:id/callback-ack", authMiddleware, requireRoles(ROLES.UPPER_PLATFORM, ROLES.ADMIN), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = callbackAckSchema.parse(req.body);
    const eventRepo = AppDataSource.getRepository(Event);

    const event = await eventRepo.findOne({ where: { id: req.params.id } });
    if (!event) {
      throw new AppError("Event not found", 404, 404);
    }

    await addEventFlow(
      event.id,
      "callback_ack",
      event.status,
      event.status,
      req.user!.userId,
      req.user!.realName,
      `Upper platform callback acknowledged: ${data.success ? "SUCCESS" : "FAILED"}${data.message ? ` - ${data.message}` : ""}`
    );

    success(res, {
      acknowledged: true,
      eventId: event.id,
      eventNo: event.eventNo,
    }, "Callback acknowledged successfully");
  } catch (err) {
    next(err);
  }
});

router.get("/sync-status", authMiddleware, requireRoles(ROLES.UPPER_PLATFORM, ROLES.ADMIN, ROLES.STREET), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const eventRepo = AppDataSource.getRepository(Event);

    const totalSynced = await eventRepo.createQueryBuilder("e")
      .where("e.reportedFrom IS NOT NULL")
      .getCount();

    const pendingSynced = await eventRepo.createQueryBuilder("e")
      .where("e.reportedFrom IS NOT NULL")
      .andWhere("e.status = :status", { status: EVENT_STATUS.PENDING })
      .getCount();

    const processingSynced = await eventRepo.createQueryBuilder("e")
      .where("e.reportedFrom IS NOT NULL")
      .andWhere("e.status IN (:...statuses)", {
        statuses: [EVENT_STATUS.ASSIGNED, EVENT_STATUS.PROCESSING, EVENT_STATUS.FEEDBACK, EVENT_STATUS.REVISITING],
      })
      .getCount();

    const completedSynced = await eventRepo.createQueryBuilder("e")
      .where("e.reportedFrom IS NOT NULL")
      .andWhere("e.status IN (:...statuses)", {
        statuses: [EVENT_STATUS.COMPLETED, EVENT_STATUS.CLOSED],
      })
      .getCount();

    const overdueSynced = await eventRepo.createQueryBuilder("e")
      .where("e.reportedFrom IS NOT NULL")
      .andWhere("e.isOverdue = :overdue", { overdue: true })
      .getCount();

    const today = dayjs();
    const todayStart = today.startOf("day").toDate();
    const todayEnd = today.endOf("day").toDate();

    const todaySynced = await eventRepo.createQueryBuilder("e")
      .where("e.reportedFrom IS NOT NULL")
      .andWhere("e.createdAt >= :start AND e.createdAt <= :end", { start: todayStart, end: todayEnd })
      .getCount();

    success(res, {
      total: totalSynced,
      pending: pendingSynced,
      processing: processingSynced,
      completed: completedSynced,
      closed: 0,
      overdue: overdueSynced,
      todaySynced,
      syncRate: totalSynced > 0 ? Math.round(completedSynced / totalSynced * 100) : 0,
    }, "Sync status retrieved successfully");
  } catch (err) {
    next(err);
  }
});

router.post("/events/batch-sync", authMiddleware, requireRoles(ROLES.UPPER_PLATFORM, ROLES.ADMIN), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const events = req.body.events;
    if (!Array.isArray(events) || events.length === 0) {
      throw new AppError("Events array is required and cannot be empty", 400, 400);
    }

    if (events.length > 100) {
      throw new AppError("Maximum 100 events can be synced per batch", 400, 400);
    }

    const eventRepo = AppDataSource.getRepository(Event);
    const notifRepo = AppDataSource.getRepository(Notification);
    const flowRepo = AppDataSource.getRepository(EventFlow);

    const results: any[] = [];
    let successCount = 0;
    let failCount = 0;

    const streetUsers = await AppDataSource.getRepository(User).find({
      where: { role: ROLES.STREET, isActive: true },
    });

    for (let i = 0; i < events.length; i++) {
      try {
        const item = events[i];
        const validated = upperPlatformEventSchema.parse(item);

        const eventNo = generateEventNo();
        const event = eventRepo.create({
          title: validated.title,
          description: validated.description,
          eventType: validated.eventType,
          eventNo,
          status: EVENT_STATUS.PENDING,
          reporterId: req.user!.userId,
          reporterName: validated.reporterName || req.user!.realName,
          reporterPhone: validated.reporterPhone,
          reportedFrom: validated.sourcePlatform,
          communityId: validated.communityId,
          gridAreaId: validated.gridAreaId,
          longitude: validated.longitude,
          latitude: validated.latitude,
          locationAddress: validated.locationAddress,
          isOverdue: false,
          isRepeated: false,
          isRevisitConfirmed: false,
          priority: validated.priority || 1,
          deadline: validated.deadline ? new Date(validated.deadline) : undefined,
          remark: validated.sourceEventNo ? `[Upper Platform] Source: ${validated.sourcePlatform}, Source Event No: ${validated.sourceEventNo}` : `[Upper Platform] Source: ${validated.sourcePlatform}`,
        });
        await eventRepo.save(event);

        const flow = flowRepo.create({
          eventId: event.id,
          action: "batch_sync",
          fromStatus: undefined,
          toStatus: EVENT_STATUS.PENDING,
          operatorId: req.user!.userId,
          operatorName: `${req.user!.realName} (${validated.sourcePlatform})`,
          remark: `Batch sync from upper platform - item ${i + 1}/${events.length}`,
        });
        await flowRepo.save(flow);

        results.push({
          index: i,
          success: true,
          id: event.id,
          eventNo: event.eventNo,
        });
        successCount++;

        for (const u of streetUsers) {
          const notif = notifRepo.create({
            userId: u.id,
            type: "event_new",
            title: "New event from upper platform batch sync",
            content: `Batch synced event from (${validated.sourcePlatform}): ${event.title} (${event.eventNo})`,
            eventId: event.id,
            isRead: false,
          });
          await notifRepo.save(notif);
        }
      } catch (itemErr: any) {
        results.push({
          index: i,
          success: false,
          error: itemErr.message || "Validation failed",
        });
        failCount++;
      }
    }

    success(res, {
      total: events.length,
      successCount,
      failCount,
      results,
    }, `Batch sync completed: ${successCount} success, ${failCount} failed`);
  } catch (err) {
    next(err);
  }
});

export default router;

import { Router, Request, Response, NextFunction } from "express";
import z from "zod";
import { v4 as uuidv4 } from "uuid";
import dayjs from "dayjs";
import { AppDataSource } from "../config/database";
import { Event } from "../entities/Event";
import { EventFlow } from "../entities/EventFlow";
import { Notification } from "../entities/Notification";
import { User } from "../entities/User";
import { Community } from "../entities/Community";
import { GridArea } from "../entities/GridArea";
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

router.get("/events/export", authMiddleware, requireRoles(ROLES.ADMIN, ROLES.STREET, ROLES.COMMUNITY, ROLES.UPPER_PLATFORM), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const eventRepo = AppDataSource.getRepository(Event);
    const communityRepo = AppDataSource.getRepository(Community);
    const gridRepo = AppDataSource.getRepository(GridArea);

    const { communityId, gridAreaId, eventType, status, isOverdue, isRepeated, gridWorkerId, startDate, endDate, sourcePlatform } = req.query;

    let builder = eventRepo.createQueryBuilder("e");

    if (communityId) builder = builder.where("e.communityId = :cid", { cid: communityId });
    if (gridAreaId) builder = builder.andWhere("e.gridAreaId = :gid", { gid: gridAreaId });
    if (eventType) builder = builder.andWhere("e.eventType = :et", { et: eventType });
    if (status) builder = builder.andWhere("e.status = :st", { st: status });
    if (isOverdue !== undefined) builder = builder.andWhere("e.isOverdue = :io", { io: isOverdue === "true" });
    if (isRepeated !== undefined) builder = builder.andWhere("e.isRepeated = :ir", { ir: isRepeated === "true" });
    if (sourcePlatform) builder = builder.andWhere("e.sourcePlatform = :sp", { sp: sourcePlatform });
    if (gridWorkerId) builder = builder.andWhere("(e.reporterId = :gwid OR e.assigneeId = :gwid)", { gwid: gridWorkerId });
    if (startDate) builder = builder.andWhere("e.createdAt >= :sd", { sd: new Date(startDate as string) });
    if (endDate) builder = builder.andWhere("e.createdAt <= :ed", { ed: new Date(endDate + "T23:59:59") });

    builder = builder.orderBy("e.createdAt", "DESC");
    const events = (await builder.getMany()) as any[];

    const communityCache = new Map<string, string>();
    const gridCache = new Map<string, string>();

    const allCommunities = (await communityRepo.find()) as any[];
    for (const c of allCommunities) communityCache.set(c.id, c.name);
    const allGrids = (await gridRepo.find()) as any[];
    for (const g of allGrids) gridCache.set(g.id, g.name);

    const fmt = (d: any) => d ? dayjs(d).format("YYYY-MM-DD HH:mm:ss") : "";
    const csvEscape = (s: any) => {
      const v = s === null || s === undefined ? "" : String(s);
      if (v.includes(",") || v.includes("\"") || v.includes("\n")) {
        return `"${v.replace(/"/g, '""')}"`;
      }
      return v;
    };

    const statusMap: any = {
      pending: "待派单",
      assigned: "已派单",
      processing: "处理中",
      feedback: "待反馈",
      revisiting: "回访中",
      completed: "已完成",
      closed: "已结案",
      overdue: "已超时",
    };

    const headers = [
      "事件编号", "标题", "社区", "网格", "事件类型", "事件等级",
      "状态", "上报人", "处理人", "是否超时", "是否重复",
      "创建时间", "派单时间", "完成时间", "截止时间",
    ];

    const rows = events.map((e: any) => [
      e.eventNo,
      e.title,
      communityCache.get(e.communityId) || "",
      gridCache.get(e.gridAreaId) || "",
      e.eventType,
      e.priority || "",
      statusMap[e.status] || e.status,
      e.reporterName || "",
      e.assigneeName || "",
      e.isOverdue ? "是" : "否",
      e.isRepeated ? "是" : "否",
      fmt(e.createdAt),
      fmt(e.assignedAt),
      fmt(e.completedAt),
      fmt(e.deadline),
    ]);

    const csv = [headers, ...rows].map(r => r.map(csvEscape).join(",")).join("\n");
    const bom = "\uFEFF";

    const filename = `events_${dayjs().format("YYYYMMDD_HHmmss")}.csv`;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(bom + csv);
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

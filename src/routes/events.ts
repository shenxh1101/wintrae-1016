import { Router, Request, Response, NextFunction } from "express";
import z from "zod";
import { v4 as uuidv4 } from "uuid";
import dayjs from "dayjs";
import { AppDataSource } from "../config/database";
import { Event } from "../entities/Event";
import { EventFlow } from "../entities/EventFlow";
import { User } from "../entities/User";
import { Notification } from "../entities/Notification";
import { success, AppError } from "../utils/response";
import { authMiddleware, requireRoles } from "../middlewares/auth";
import { ROLES, EVENT_STATUS, EVENT_TYPES } from "../config";

const router = Router();

function generateEventNo(): string {
  const now = dayjs();
  const random = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `EVT${now.format("YYYYMMDDHHmmss")}${random}`;
}

const eventCreateSchema = z.object({
  title: z.string().min(1, "Title is required"),
  description: z.string().min(1, "Description is required"),
  eventType: z.enum([...EVENT_TYPES] as any),
  communityId: z.string().optional(),
  gridAreaId: z.string().optional(),
  longitude: z.number().optional(),
  latitude: z.number().optional(),
  locationAddress: z.string().optional(),
  reporterName: z.string().optional(),
  reporterPhone: z.string().optional(),
  reportedFrom: z.string().optional(),
  deadline: z.string().optional(),
  priority: z.number().optional(),
  remark: z.string().optional(),
});

const eventUpdateSchema = z.object({
  title: z.string().min(1, "Title is required").optional(),
  description: z.string().min(1, "Description is required").optional(),
  eventType: z.enum([...EVENT_TYPES] as any).optional(),
  communityId: z.string().optional(),
  gridAreaId: z.string().optional(),
  longitude: z.number().optional(),
  latitude: z.number().optional(),
  locationAddress: z.string().optional(),
  deadline: z.string().optional(),
  priority: z.number().optional(),
  remark: z.string().optional(),
});

const assignSchema = z.object({
  assigneeId: z.string().min(1, "Assignee ID is required"),
  deadline: z.string().optional(),
  remark: z.string().optional(),
});

const processSchema = z.object({
  processResult: z.string().min(1, "Process result is required"),
  remark: z.string().optional(),
});

const revisitSchema = z.object({
  revisitResult: z.string().min(1, "Revisit result is required"),
  isRevisitConfirmed: z.boolean(),
  revisitRemark: z.string().optional(),
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

async function createNotification(
  userId: string,
  type: string,
  title: string,
  content: string,
  eventId?: string
) {
  const notifRepo = AppDataSource.getRepository(Notification);
  const notif = notifRepo.create({
    userId,
    type,
    title,
    content,
    eventId,
    isRead: false,
  });
  await notifRepo.save(notif);
}

router.get("/", authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const {
      page = 1,
      pageSize = 10,
      keyword,
      status,
      eventType,
      communityId,
      gridAreaId,
      assigneeId,
      reporterId,
      isOverdue,
      startDate,
      endDate,
    } = req.query;

    const eventRepo = AppDataSource.getRepository(Event);

    let queryBuilder = eventRepo.createQueryBuilder("e")
      .leftJoinAndSelect("e.community", "c")
      .leftJoinAndSelect("e.gridArea", "g")
      .leftJoinAndSelect("e.reporter", "r")
      .leftJoinAndSelect("e.assignee", "a");

    if (keyword) {
      queryBuilder = queryBuilder.where(
        "e.title LIKE :kw OR e.description LIKE :kw OR e.eventNo LIKE :kw OR e.locationAddress LIKE :kw",
        { kw: `%${keyword}%` }
      );
    }

    if (status) {
      queryBuilder = queryBuilder.andWhere("e.status = :status", { status });
    }

    if (eventType) {
      queryBuilder = queryBuilder.andWhere("e.eventType = :et", { et: eventType });
    }

    if (communityId) {
      queryBuilder = queryBuilder.andWhere("e.communityId = :cid", { cid: communityId });
    }

    if (gridAreaId) {
      queryBuilder = queryBuilder.andWhere("e.gridAreaId = :gid", { gid: gridAreaId });
    }

    if (assigneeId) {
      queryBuilder = queryBuilder.andWhere("e.assigneeId = :aid", { aid: assigneeId });
    }

    if (reporterId) {
      queryBuilder = queryBuilder.andWhere("e.reporterId = :rid", { rid: reporterId });
    }

    if (isOverdue !== undefined && isOverdue !== null) {
      const overdue = String(isOverdue) === "true";
      queryBuilder = queryBuilder.andWhere("e.isOverdue = :io", { io: overdue });
    }

    if (startDate) {
      queryBuilder = queryBuilder.andWhere("e.createdAt >= :sd", { sd: new Date(startDate as string) });
    }

    if (endDate) {
      queryBuilder = queryBuilder.andWhere("e.createdAt <= :ed", { ed: new Date(endDate as string) });
    }

    const userRole = req.user!.role;
    const userId = req.user!.userId;

    if (userRole === ROLES.COMMUNITY) {
      const userCommunityId = req.user!.userEntity?.communityId;
      if (userCommunityId) {
        queryBuilder = queryBuilder.andWhere("e.communityId = :ucid", { ucid: userCommunityId });
      }
    } else if (userRole === ROLES.GRID_WORKER) {
      queryBuilder = queryBuilder.andWhere(
        "(e.assigneeId = :uid OR e.reporterId = :uid)",
        { uid: userId }
      );
    }

    const total = await queryBuilder.getCount();
    const events = await queryBuilder
      .skip((Number(page) - 1) * Number(pageSize))
      .take(Number(pageSize))
      .orderBy("e.createdAt", "DESC")
      .getMany();

    success(res, events, "Events retrieved successfully", {
      total,
      page: Number(page),
      pageSize: Number(pageSize),
    });
  } catch (err) {
    next(err);
  }
});

router.get("/:id", authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const eventRepo = AppDataSource.getRepository(Event);
    const flowRepo = AppDataSource.getRepository(EventFlow);

    const event = await eventRepo.findOne({
      where: { id: req.params.id },
      relations: ["community", "gridArea", "reporter", "assignee"],
    });

    if (!event) {
      throw new AppError("Event not found", 404, 404);
    }

    const flows = await flowRepo.find({
      where: { eventId: req.params.id },
      order: { createdAt: "ASC" },
    });

    success(res, { ...event, flows }, "Event retrieved successfully");
  } catch (err) {
    next(err);
  }
});

router.post("/", authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = eventCreateSchema.parse(req.body);
    const eventRepo = AppDataSource.getRepository(Event);

    const eventNo = generateEventNo();
    const event = eventRepo.create({
      ...data,
      eventNo,
      status: EVENT_STATUS.PENDING,
      reporterId: req.user!.userId,
      reporterName: req.user!.realName,
      isOverdue: false,
      isRepeated: false,
      isRevisitConfirmed: false,
      priority: data.priority || 1,
      deadline: data.deadline ? new Date(data.deadline) : undefined,
    });
    await eventRepo.save(event);

    await addEventFlow(
      event.id,
      "create",
      undefined,
      EVENT_STATUS.PENDING,
      req.user!.userId,
      req.user!.realName,
      "Event created"
    );

    const streetUsers = await AppDataSource.getRepository(User).find({
      where: { role: ROLES.STREET, isActive: true },
    });
    for (const u of streetUsers) {
      await createNotification(
        u.id,
        "event_new",
        "New event to be assigned",
        `New event: ${event.title} (${event.eventNo}), please assign it promptly.`,
        event.id
      );
    }

    success(res, event, "Event created successfully");
  } catch (err) {
    next(err);
  }
});

router.put("/:id", authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = eventUpdateSchema.parse(req.body);
    const eventRepo = AppDataSource.getRepository(Event);

    const event = await eventRepo.findOne({ where: { id: req.params.id } });
    if (!event) {
      throw new AppError("Event not found", 404, 404);
    }

    const oldStatus = event.status;
    const updateData: any = { ...data };
    if (data.deadline) {
      updateData.deadline = new Date(data.deadline);
    }

    Object.assign(event, updateData);
    await eventRepo.save(event);

    await addEventFlow(
      event.id,
      "edit",
      oldStatus,
      event.status,
      req.user!.userId,
      req.user!.realName,
      "Event edited"
    );

    success(res, event, "Event updated successfully");
  } catch (err) {
    next(err);
  }
});

router.post("/:id/assign", authMiddleware, requireRoles(ROLES.ADMIN, ROLES.STREET, ROLES.COMMUNITY), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = assignSchema.parse(req.body);
    const eventRepo = AppDataSource.getRepository(Event);
    const userRepo = AppDataSource.getRepository(User);

    const event = await eventRepo.findOne({ where: { id: req.params.id } });
    if (!event) {
      throw new AppError("Event not found", 404, 404);
    }

    const assignee = await userRepo.findOne({ where: { id: data.assigneeId, isActive: true } });
    if (!assignee) {
      throw new AppError("Assignee not found or inactive", 400, 400);
    }

    if (assignee.role !== ROLES.GRID_WORKER && assignee.role !== ROLES.COMMUNITY) {
      throw new AppError("Assignee must be a grid worker or community admin", 400, 400);
    }

    const oldStatus = event.status;
    event.assigneeId = data.assigneeId;
    event.assignedAt = new Date();
    event.status = EVENT_STATUS.ASSIGNED;
    if (data.deadline) {
      event.deadline = new Date(data.deadline);
    }
    await eventRepo.save(event);

    await addEventFlow(
      event.id,
      "assign",
      oldStatus,
      EVENT_STATUS.ASSIGNED,
      req.user!.userId,
      req.user!.realName,
      `Assigned to ${assignee.realName}${data.remark ? ` - ${data.remark}` : ""}`
    );

    await createNotification(
      data.assigneeId,
      "event_assigned",
      "New event assigned",
      `You have been assigned event: ${event.title} (${event.eventNo}), please handle it promptly.`,
      event.id
    );

    success(res, event, "Event assigned successfully");
  } catch (err) {
    next(err);
  }
});

router.post("/:id/start", authMiddleware, requireRoles(ROLES.GRID_WORKER, ROLES.COMMUNITY), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const eventRepo = AppDataSource.getRepository(Event);

    const event = await eventRepo.findOne({ where: { id: req.params.id } });
    if (!event) {
      throw new AppError("Event not found", 404, 404);
    }

    if (event.assigneeId !== req.user!.userId) {
      throw new AppError("You are not the assigned handler for this event", 403, 403);
    }

    if (event.status !== EVENT_STATUS.ASSIGNED) {
      throw new AppError("Only assigned events can be started", 400, 400);
    }

    const oldStatus = event.status;
    event.status = EVENT_STATUS.PROCESSING;
    await eventRepo.save(event);

    await addEventFlow(
      event.id,
      "start",
      oldStatus,
      EVENT_STATUS.PROCESSING,
      req.user!.userId,
      req.user!.realName,
      "Event processing started"
    );

    success(res, event, "Event started successfully");
  } catch (err) {
    next(err);
  }
});

router.post("/:id/feedback", authMiddleware, requireRoles(ROLES.GRID_WORKER, ROLES.COMMUNITY), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = processSchema.parse(req.body);
    const eventRepo = AppDataSource.getRepository(Event);

    const event = await eventRepo.findOne({ where: { id: req.params.id } });
    if (!event) {
      throw new AppError("Event not found", 404, 404);
    }

    if (event.assigneeId !== req.user!.userId) {
      throw new AppError("You are not the assigned handler for this event", 403, 403);
    }

    if (event.status !== EVENT_STATUS.PROCESSING) {
      throw new AppError("Only processing events can be submitted for feedback", 400, 400);
    }

    const oldStatus = event.status;
    event.processResult = data.processResult;
    event.status = EVENT_STATUS.FEEDBACK;
    event.completedAt = new Date();
    await eventRepo.save(event);

    await addEventFlow(
      event.id,
      "feedback",
      oldStatus,
      EVENT_STATUS.FEEDBACK,
      req.user!.userId,
      req.user!.realName,
      data.remark || "Processing result submitted"
    );

    const reporter = event.reporterId;
    if (reporter) {
      await createNotification(
        reporter,
        "event_feedback",
        "Event processing feedback submitted",
        `Event ${event.title} (${event.eventNo}) has been processed with result: ${data.processResult}`,
        event.id
      );
    }

    success(res, event, "Feedback submitted successfully");
  } catch (err) {
    next(err);
  }
});

router.post("/:id/revisit", authMiddleware, requireRoles(ROLES.ADMIN, ROLES.STREET, ROLES.COMMUNITY), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = revisitSchema.parse(req.body);
    const eventRepo = AppDataSource.getRepository(Event);

    const event = await eventRepo.findOne({ where: { id: req.params.id } });
    if (!event) {
      throw new AppError("Event not found", 404, 404);
    }

    if (event.status !== EVENT_STATUS.FEEDBACK && event.status !== EVENT_STATUS.REVISITING) {
      throw new AppError("Only events with submitted feedback can be revisited", 400, 400);
    }

    const oldStatus = event.status;
    event.revisitResult = data.revisitResult;
    event.isRevisitConfirmed = data.isRevisitConfirmed;
    event.revisitedAt = new Date();
    event.revisitRemark = data.revisitRemark;

    if (data.isRevisitConfirmed) {
      event.status = EVENT_STATUS.COMPLETED;
    } else {
      event.status = EVENT_STATUS.PROCESSING;
    }
    await eventRepo.save(event);

    await addEventFlow(
      event.id,
      "revisit",
      oldStatus,
      event.status,
      req.user!.userId,
      req.user!.realName,
      `Revisit: ${data.isRevisitConfirmed ? "Confirmed" : "Return for reprocessing"} - ${data.revisitResult}`
    );

    if (event.assigneeId && !data.isRevisitConfirmed) {
      await createNotification(
        event.assigneeId,
        "event_revisit_rejected",
        "Revisit unconfirmed, event returned for reprocessing",
        `Event ${event.title} (${event.eventNo}) revisit result is unconfirmed. Reason: ${data.revisitResult}. Please reprocess.`,
        event.id
      );
    }

    success(res, event, "Revisit completed successfully");
  } catch (err) {
    next(err);
  }
});

router.post("/:id/close", authMiddleware, requireRoles(ROLES.ADMIN, ROLES.STREET, ROLES.COMMUNITY), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const eventRepo = AppDataSource.getRepository(Event);

    const event = await eventRepo.findOne({ where: { id: req.params.id } });
    if (!event) {
      throw new AppError("Event not found", 404, 404);
    }

    if (event.status !== EVENT_STATUS.COMPLETED) {
      throw new AppError("Only completed events can be closed", 400, 400);
    }

    const oldStatus = event.status;
    event.status = EVENT_STATUS.CLOSED;
    await eventRepo.save(event);

    await addEventFlow(
      event.id,
      "close",
      oldStatus,
      EVENT_STATUS.CLOSED,
      req.user!.userId,
      req.user!.realName,
      "Event closed"
    );

    success(res, event, "Event closed successfully");
  } catch (err) {
    next(err);
  }
});

router.delete("/:id", authMiddleware, requireRoles(ROLES.ADMIN, ROLES.STREET), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const eventRepo = AppDataSource.getRepository(Event);
    const flowRepo = AppDataSource.getRepository(EventFlow);

    const event = await eventRepo.findOne({ where: { id: req.params.id } });
    if (!event) {
      throw new AppError("Event not found", 404, 404);
    }

    await flowRepo.delete({ eventId: event.id });
    await eventRepo.remove(event);

    success(res, null, "Event deleted successfully");
  } catch (err) {
    next(err);
  }
});

router.get("/:id/flows", authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const flowRepo = AppDataSource.getRepository(EventFlow);
    const flows = await flowRepo.find({
      where: { eventId: req.params.id },
      order: { createdAt: "ASC" },
    });

    success(res, flows, "Event flows retrieved successfully");
  } catch (err) {
    next(err);
  }
});

const mobileReportSchema = z.object({
  title: z.string().min(1, "Title is required"),
  description: z.string().min(1, "Description is required"),
  eventType: z.enum([...EVENT_TYPES] as any),
  longitude: z.number().optional(),
  latitude: z.number().optional(),
  locationAddress: z.string().optional(),
  attachmentIds: z.array(z.string()).optional(),
  deadlineHours: z.number().optional(),
});

router.post("/mobile-report", authMiddleware, requireRoles(ROLES.GRID_WORKER), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = mobileReportSchema.safeParse(req.body);
    if (!result.success) {
      return AppError.throwValidationError(result.error);
    }
    const data = result.data;

    const eventRepo = AppDataSource.getRepository(Event);
    const flowRepo = AppDataSource.getRepository(EventFlow);
    const notifRepo = AppDataSource.getRepository(Notification);

    const authUser = req.user!;
    const userEntity = authUser.userEntity!;
    const now = new Date();
    const deadline = data.deadlineHours
      ? new Date(now.getTime() + data.deadlineHours * 60 * 60 * 1000)
      : new Date(now.getTime() + 24 * 60 * 60 * 1000);

    const event = eventRepo.create({
      eventNo: generateEventNo(),
      title: data.title,
      description: data.description,
      eventType: data.eventType,
      status: EVENT_STATUS.ASSIGNED,
      priority: "normal",
      communityId: userEntity.communityId,
      gridAreaId: userEntity.gridAreaId,
      reporterId: authUser.userId,
      reporterName: authUser.realName,
      assigneeId: authUser.userId,
      assigneeName: authUser.realName,
      assignedAt: now,
      longitude: data.longitude,
      latitude: data.latitude,
      locationAddress: data.locationAddress,
      attachmentIds: data.attachmentIds || [],
      deadline,
      source: "mobile",
      isOverdue: false,
      isRepeated: false,
      isRevisitConfirmed: false,
    });
    const saved = await eventRepo.save(event);

    const flow = flowRepo.create({
      eventId: saved.id,
      fromStatus: EVENT_STATUS.PENDING,
      toStatus: EVENT_STATUS.ASSIGNED,
      operatorId: authUser.userId,
      operatorName: authUser.realName,
      action: "mobile_report",
      remark: "Mobile reported and auto-assigned",
    });
    await flowRepo.save(flow);

    await notifRepo.save(notifRepo.create({
      userId: authUser.userId,
      title: "New event assigned",
      content: `New event: ${data.title}`,
      type: "assign",
      bizType: "event",
      bizId: saved.id,
    }));

    const populated = await eventRepo.findOne({
      where: { id: saved.id },
      relations: ["community", "gridArea", "reporter", "assignee"],
    });
    success(res, populated, "Event reported successfully, todo created");
  } catch (err) {
    next(err);
  }
});

router.post("/:id/return", authMiddleware, requireRoles(ROLES.ADMIN, ROLES.STREET, ROLES.COMMUNITY), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const eventRepo = AppDataSource.getRepository(Event);
    const flowRepo = AppDataSource.getRepository(EventFlow);
    const notifRepo = AppDataSource.getRepository(Notification);

    const event = await eventRepo.findOne({ where: { id: req.params.id } });
    if (!event) return AppError.throwNotFound("Event not found");

    const { remark } = req.body;
    const authUser = req.user!;
    const fromStatus = event.status;

    event.status = EVENT_STATUS.ASSIGNED;
    event.returnReason = remark || "";
    event.revisitResult = undefined;
    event.revisitedAt = undefined;
    event.reviewerId = undefined;
    event.reviewerName = undefined;
    event.isRevisitConfirmed = false;

    const updated = await eventRepo.save(event);

    await flowRepo.save(flowRepo.create({
      eventId: event.id,
      fromStatus,
      toStatus: EVENT_STATUS.ASSIGNED,
      operatorId: authUser.userId,
      operatorName: authUser.realName,
      action: "return",
      remark: remark || "Returned for reprocessing",
    }));

    if (event.assigneeId) {
      await notifRepo.save(notifRepo.create({
        userId: event.assigneeId,
        title: "Event returned",
        content: `Event ${event.eventNo} returned: ${remark || "reprocess"}`,
        type: "system",
        bizType: "event",
        bizId: event.id,
      }));
    }

    success(res, updated, "Event returned successfully");
  } catch (err) {
    next(err);
  }
});

const urgeSchema = z.object({
  content: z.string().min(1, "Urge content is required"),
});

router.post("/:id/urge", authMiddleware, requireRoles(ROLES.ADMIN, ROLES.STREET, ROLES.COMMUNITY), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = urgeSchema.safeParse(req.body);
    if (!result.success) {
      return AppError.throwValidationError(result.error);
    }
    const { content } = result.data;

    const eventRepo = AppDataSource.getRepository(Event);
    const flowRepo = AppDataSource.getRepository(EventFlow);
    const notifRepo = AppDataSource.getRepository(Notification);

    const event = await eventRepo.findOne({ where: { id: req.params.id } });
    if (!event) return AppError.throwNotFound("Event not found");

    if (event.status === EVENT_STATUS.COMPLETED || event.status === EVENT_STATUS.CLOSED) {
      throw new AppError("Completed or closed events cannot be urged", 400, 400);
    }

    const authUser = req.user!;
    const handlerId = event.assigneeId;

    if (handlerId) {
      const notif = notifRepo.create({
        userId: handlerId,
        type: "urge",
        title: "Event handling urged",
        content: `Urgent reminder for event "${event.title}" (${event.eventNo}): ${content}`,
        eventId: event.id,
        isRead: false,
      });
      await notifRepo.save(notif);
    }

    await flowRepo.save(flowRepo.create({
      eventId: event.id,
      action: "urge",
      fromStatus: event.status,
      toStatus: event.status,
      operatorId: authUser.userId,
      operatorName: authUser.realName,
      remark: content,
    }));

    const flows = await flowRepo.find({
      where: { eventId: event.id },
      order: { createdAt: "ASC" },
    });

    success(res, {
      event: { id: event.id, status: event.status, eventNo: event.eventNo },
      urged: true,
      urgedAt: new Date(),
      flows,
    }, "Event urged successfully, notification sent to handler");
  } catch (err) {
    next(err);
  }
});

export default router;

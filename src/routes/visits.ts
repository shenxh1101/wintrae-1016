import { Router, Request, Response, NextFunction } from "express";
import z from "zod";
import { AppDataSource } from "../config/database";
import { VisitRecord } from "../entities/VisitRecord";
import { Event } from "../entities/Event";
import { success, AppError } from "../utils/response";
import { authMiddleware, requireRoles } from "../middlewares/auth";
import { ROLES, VISIT_TYPES } from "../config";

const router = Router();

const visitCreateSchema = z.object({
  visitType: z.enum([...VISIT_TYPES] as any),
  residentId: z.string().optional(),
  visitTime: z.string(),
  longitude: z.number().optional(),
  latitude: z.number().optional(),
  content: z.string().min(1, "Content is required"),
  situation: z.string().optional(),
  problem: z.string().optional(),
  solution: z.string().optional(),
  remark: z.string().optional(),
  hasIssue: z.boolean().optional(),
  relatedEventId: z.string().optional(),
  communityId: z.string().optional(),
  gridAreaId: z.string().optional(),
});

const visitUpdateSchema = z.object({
  visitType: z.enum([...VISIT_TYPES] as any).optional(),
  residentId: z.string().optional(),
  visitTime: z.string().optional(),
  longitude: z.number().optional(),
  latitude: z.number().optional(),
  content: z.string().min(1, "Content is required").optional(),
  situation: z.string().optional(),
  problem: z.string().optional(),
  solution: z.string().optional(),
  remark: z.string().optional(),
  hasIssue: z.boolean().optional(),
  relatedEventId: z.string().optional(),
});

router.get("/", authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const {
      page = 1,
      pageSize = 10,
      keyword,
      visitType,
      visitorId,
      residentId,
      communityId,
      gridAreaId,
      hasIssue,
      startDate,
      endDate,
    } = req.query;

    const visitRepo = AppDataSource.getRepository(VisitRecord);

    let queryBuilder = visitRepo.createQueryBuilder("v")
      .leftJoinAndSelect("v.resident", "r")
      .leftJoinAndSelect("v.visitor", "u")
      .leftJoinAndSelect("v.community", "c")
      .leftJoinAndSelect("v.gridArea", "g");

    if (keyword) {
      queryBuilder = queryBuilder.where(
        "v.content LIKE :kw OR v.situation LIKE :kw OR v.problem LIKE :kw OR v.solution LIKE :kw",
        { kw: `%${keyword}%` }
      );
    }

    if (visitType) {
      queryBuilder = queryBuilder.andWhere("v.visitType = :vt", { vt: visitType });
    }

    if (visitorId) {
      queryBuilder = queryBuilder.andWhere("v.visitorId = :vid", { vid: visitorId });
    }

    if (residentId) {
      queryBuilder = queryBuilder.andWhere("v.residentId = :rid", { rid: residentId });
    }

    if (communityId) {
      queryBuilder = queryBuilder.andWhere("v.communityId = :cid", { cid: communityId });
    }

    if (gridAreaId) {
      queryBuilder = queryBuilder.andWhere("v.gridAreaId = :gid", { gid: gridAreaId });
    }

    if (hasIssue !== undefined && hasIssue !== null) {
      const hi = String(hasIssue) === "true";
      queryBuilder = queryBuilder.andWhere("v.hasIssue = :hi", { hi });
    }

    if (startDate) {
      queryBuilder = queryBuilder.andWhere("v.visitTime >= :sd", { sd: new Date(startDate as string) });
    }

    if (endDate) {
      queryBuilder = queryBuilder.andWhere("v.visitTime <= :ed", { ed: new Date(endDate as string) });
    }

    const userRole = req.user!.role;
    const userId = req.user!.userId;

    if (userRole === ROLES.COMMUNITY) {
      const userCommunityId = req.user!.userEntity?.communityId;
      if (userCommunityId) {
        queryBuilder = queryBuilder.andWhere("v.communityId = :ucid", { ucid: userCommunityId });
      }
    } else if (userRole === ROLES.GRID_WORKER) {
      queryBuilder = queryBuilder.andWhere("v.visitorId = :uid", { uid: userId });
    }

    const total = await queryBuilder.getCount();
    const visits = await queryBuilder
      .skip((Number(page) - 1) * Number(pageSize))
      .take(Number(pageSize))
      .orderBy("v.visitTime", "DESC")
      .getMany();

    success(res, visits, "Visit records retrieved successfully", {
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
    const visitRepo = AppDataSource.getRepository(VisitRecord);
    const visit = await visitRepo.findOne({
      where: { id: req.params.id },
      relations: ["resident", "visitor", "community", "gridArea"],
    });

    if (!visit) {
      throw new AppError("Visit record not found", 404, 404);
    }

    success(res, visit, "Visit record retrieved successfully");
  } catch (err) {
    next(err);
  }
});

router.post("/", authMiddleware, requireRoles(ROLES.ADMIN, ROLES.STREET, ROLES.COMMUNITY, ROLES.GRID_WORKER), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = visitCreateSchema.parse(req.body);
    const visitRepo = AppDataSource.getRepository(VisitRecord);
    const eventRepo = AppDataSource.getRepository(Event);

    const visit = visitRepo.create({
      ...data,
      visitorId: req.user!.userId,
      visitorName: req.user!.realName,
      visitTime: new Date(data.visitTime),
      hasIssue: data.hasIssue || false,
      communityId: data.communityId || req.user!.userEntity?.communityId,
      gridAreaId: data.gridAreaId || req.user!.userEntity?.gridAreaId,
    });
    await visitRepo.save(visit);

    if (data.hasIssue && !data.relatedEventId) {
      const eventNo = `EVT-FROM-VISIT-${Date.now()}`;
      const event = eventRepo.create({
        eventNo,
        title: `Visit Issue: ${data.visitType} - ${data.problem || data.content.substring(0, 50)}`,
        description: `Generated from visit record.\nVisit content: ${data.content}\nProblem: ${data.problem || "Not specified"}\nSolution: ${data.solution || "Pending"}`,
        eventType: "民生服务",
        status: "pending",
        reporterId: req.user!.userId,
        reporterName: req.user!.realName,
        communityId: visit.communityId,
        gridAreaId: visit.gridAreaId,
        isOverdue: false,
        isRepeated: false,
        isRevisitConfirmed: false,
        priority: 1,
      });
      await eventRepo.save(event);

      visit.relatedEventId = event.id;
      await visitRepo.save(visit);
    }

    success(res, visit, "Visit record created successfully");
  } catch (err) {
    next(err);
  }
});

router.put("/:id", authMiddleware, requireRoles(ROLES.ADMIN, ROLES.STREET, ROLES.COMMUNITY, ROLES.GRID_WORKER), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = visitUpdateSchema.parse(req.body);
    const visitRepo = AppDataSource.getRepository(VisitRecord);

    const visit = await visitRepo.findOne({ where: { id: req.params.id } });
    if (!visit) {
      throw new AppError("Visit record not found", 404, 404);
    }

    if (visit.visitorId !== req.user!.userId && !["admin", "street", "community"].includes(req.user!.role)) {
      throw new AppError("No permission to edit this visit record", 403, 403);
    }

    const updateData: any = { ...data };
    if (data.visitTime) {
      updateData.visitTime = new Date(data.visitTime);
    }

    Object.assign(visit, updateData);
    await visitRepo.save(visit);

    success(res, visit, "Visit record updated successfully");
  } catch (err) {
    next(err);
  }
});

router.delete("/:id", authMiddleware, requireRoles(ROLES.ADMIN, ROLES.STREET, ROLES.COMMUNITY), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const visitRepo = AppDataSource.getRepository(VisitRecord);
    const visit = await visitRepo.findOne({ where: { id: req.params.id } });

    if (!visit) {
      throw new AppError("Visit record not found", 404, 404);
    }

    await visitRepo.remove(visit);

    success(res, null, "Visit record deleted successfully");
  } catch (err) {
    next(err);
  }
});

export default router;

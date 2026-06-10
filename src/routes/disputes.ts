import { Router, Request, Response, NextFunction } from "express";
import z from "zod";
import { AppDataSource } from "../config/database";
import { DisputeRecord } from "../entities/DisputeRecord";
import { success, AppError } from "../utils/response";
import { authMiddleware, requireRoles } from "../middlewares/auth";
import { ROLES } from "../config";

const router = Router();

const DISPUTE_STATUS = {
  PENDING: "pending",
  MEDIATING: "mediating",
  RESOLVED: "resolved",
  ESCALATED: "escalated",
  CLOSED: "closed",
} as const;

const DISPUTE_TYPES = [
  "邻里纠纷",
  "家庭纠纷",
  "物业纠纷",
  "土地纠纷",
  "经济纠纷",
  "劳动纠纷",
  "婚姻家庭",
  "损害赔偿",
  "其他",
] as const;

const disputeCreateSchema = z.object({
  title: z.string().min(1, "Title is required"),
  disputeType: z.enum([...DISPUTE_TYPES] as any),
  description: z.string().min(1, "Description is required"),
  partyAId: z.string().optional(),
  partyAName: z.string().optional(),
  partyBName: z.string().min(1, "Party B name is required"),
  partyBContact: z.string().optional(),
  mediatorId: z.string().optional(),
  mediatorName: z.string().optional(),
  communityId: z.string().optional(),
  gridAreaId: z.string().optional(),
  locationAddress: z.string().optional(),
  occurrenceTime: z.string().optional(),
  relatedEventId: z.string().optional(),
  remark: z.string().optional(),
});

const disputeUpdateSchema = z.object({
  title: z.string().min(1, "Title is required").optional(),
  disputeType: z.enum([...DISPUTE_TYPES] as any).optional(),
  description: z.string().min(1, "Description is required").optional(),
  partyAId: z.string().optional(),
  partyAName: z.string().optional(),
  partyBName: z.string().optional(),
  partyBContact: z.string().optional(),
  mediatorId: z.string().optional(),
  mediatorName: z.string().optional(),
  communityId: z.string().optional(),
  gridAreaId: z.string().optional(),
  locationAddress: z.string().optional(),
  occurrenceTime: z.string().optional(),
  status: z.enum([
    DISPUTE_STATUS.PENDING,
    DISPUTE_STATUS.MEDIATING,
    DISPUTE_STATUS.RESOLVED,
    DISPUTE_STATUS.ESCALATED,
    DISPUTE_STATUS.CLOSED,
  ]).optional(),
  mediationProcess: z.string().optional(),
  mediationResult: z.string().optional(),
  agreement: z.string().optional(),
  resolvedAt: z.string().optional(),
  relatedEventId: z.string().optional(),
  remark: z.string().optional(),
});

const mediateSchema = z.object({
  mediationProcess: z.string().min(1, "Mediation process is required"),
  mediationResult: z.string().optional(),
  agreement: z.string().optional(),
  status: z.enum([DISPUTE_STATUS.MEDIATING, DISPUTE_STATUS.RESOLVED, DISPUTE_STATUS.ESCALATED]),
});

router.get("/", authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const {
      page = 1,
      pageSize = 10,
      keyword,
      status,
      disputeType,
      communityId,
      gridAreaId,
      mediatorId,
      startDate,
      endDate,
    } = req.query;

    const disputeRepo = AppDataSource.getRepository(DisputeRecord);

    let queryBuilder = disputeRepo.createQueryBuilder("d")
      .leftJoinAndSelect("d.partyA", "pa")
      .leftJoinAndSelect("d.mediator", "m")
      .leftJoinAndSelect("d.community", "c")
      .leftJoinAndSelect("d.gridArea", "g");

    if (keyword) {
      queryBuilder = queryBuilder.where(
        "d.title LIKE :kw OR d.description LIKE :kw OR d.partyAName LIKE :kw OR d.partyBName LIKE :kw",
        { kw: `%${keyword}%` }
      );
    }

    if (status) {
      queryBuilder = queryBuilder.andWhere("d.status = :status", { status });
    }

    if (disputeType) {
      queryBuilder = queryBuilder.andWhere("d.disputeType = :dt", { dt: disputeType });
    }

    if (communityId) {
      queryBuilder = queryBuilder.andWhere("d.communityId = :cid", { cid: communityId });
    }

    if (gridAreaId) {
      queryBuilder = queryBuilder.andWhere("d.gridAreaId = :gid", { gid: gridAreaId });
    }

    if (mediatorId) {
      queryBuilder = queryBuilder.andWhere("d.mediatorId = :mid", { mid: mediatorId });
    }

    if (startDate) {
      queryBuilder = queryBuilder.andWhere("d.createdAt >= :sd", { sd: new Date(startDate as string) });
    }

    if (endDate) {
      queryBuilder = queryBuilder.andWhere("d.createdAt <= :ed", { ed: new Date(endDate as string) });
    }

    const userRole = req.user!.role;
    const userId = req.user!.userId;

    if (userRole === ROLES.COMMUNITY) {
      const userCommunityId = req.user!.userEntity?.communityId;
      if (userCommunityId) {
        queryBuilder = queryBuilder.andWhere("d.communityId = :ucid", { ucid: userCommunityId });
      }
    } else if (userRole === ROLES.GRID_WORKER) {
      queryBuilder = queryBuilder.andWhere(
        "(d.mediatorId = :uid OR d.partyAId = :uid)",
        { uid: userId }
      );
    }

    const total = await queryBuilder.getCount();
    const disputes = await queryBuilder
      .skip((Number(page) - 1) * Number(pageSize))
      .take(Number(pageSize))
      .orderBy("d.createdAt", "DESC")
      .getMany();

    success(res, disputes, "Dispute records retrieved successfully", {
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
    const disputeRepo = AppDataSource.getRepository(DisputeRecord);
    const dispute = await disputeRepo.findOne({
      where: { id: req.params.id },
      relations: ["partyA", "mediator", "community", "gridArea"],
    });

    if (!dispute) {
      throw new AppError("Dispute record not found", 404, 404);
    }

    success(res, dispute, "Dispute record retrieved successfully");
  } catch (err) {
    next(err);
  }
});

router.post("/", authMiddleware, requireRoles(ROLES.ADMIN, ROLES.STREET, ROLES.COMMUNITY, ROLES.GRID_WORKER), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = disputeCreateSchema.parse(req.body);
    const disputeRepo = AppDataSource.getRepository(DisputeRecord);

    const dispute = disputeRepo.create({
      ...data,
      status: DISPUTE_STATUS.PENDING,
      mediatorId: data.mediatorId || req.user!.userId,
      mediatorName: data.mediatorName || req.user!.realName,
      occurrenceTime: data.occurrenceTime ? new Date(data.occurrenceTime) : new Date(),
      communityId: data.communityId || req.user!.userEntity?.communityId,
      gridAreaId: data.gridAreaId || req.user!.userEntity?.gridAreaId,
    });
    await disputeRepo.save(dispute);

    success(res, dispute, "Dispute record created successfully");
  } catch (err) {
    next(err);
  }
});

router.post("/:id/mediate", authMiddleware, requireRoles(ROLES.ADMIN, ROLES.STREET, ROLES.COMMUNITY, ROLES.GRID_WORKER), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = mediateSchema.parse(req.body);
    const disputeRepo = AppDataSource.getRepository(DisputeRecord);

    const dispute = await disputeRepo.findOne({ where: { id: req.params.id } });
    if (!dispute) {
      throw new AppError("Dispute record not found", 404, 404);
    }

    dispute.mediationProcess = (dispute.mediationProcess || "") + `\n[${new Date().toISOString()}] ${req.user!.realName}:\n${data.mediationProcess}`;
    dispute.status = data.status;

    if (data.mediationResult) {
      dispute.mediationResult = data.mediationResult;
    }

    if (data.agreement) {
      dispute.agreement = data.agreement;
    }

    if (data.status === DISPUTE_STATUS.RESOLVED) {
      dispute.resolvedAt = new Date();
    }

    await disputeRepo.save(dispute);

    success(res, dispute, "Mediation record saved successfully");
  } catch (err) {
    next(err);
  }
});

router.put("/:id", authMiddleware, requireRoles(ROLES.ADMIN, ROLES.STREET, ROLES.COMMUNITY, ROLES.GRID_WORKER), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = disputeUpdateSchema.parse(req.body);
    const disputeRepo = AppDataSource.getRepository(DisputeRecord);

    const dispute = await disputeRepo.findOne({ where: { id: req.params.id } });
    if (!dispute) {
      throw new AppError("Dispute record not found", 404, 404);
    }

    const updateData: any = { ...data };
    if (data.occurrenceTime) {
      updateData.occurrenceTime = new Date(data.occurrenceTime);
    }
    if (data.resolvedAt) {
      updateData.resolvedAt = new Date(data.resolvedAt);
    }

    Object.assign(dispute, updateData);
    await disputeRepo.save(dispute);

    success(res, dispute, "Dispute record updated successfully");
  } catch (err) {
    next(err);
  }
});

router.delete("/:id", authMiddleware, requireRoles(ROLES.ADMIN, ROLES.STREET), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const disputeRepo = AppDataSource.getRepository(DisputeRecord);
    const dispute = await disputeRepo.findOne({ where: { id: req.params.id } });

    if (!dispute) {
      throw new AppError("Dispute record not found", 404, 404);
    }

    await disputeRepo.remove(dispute);

    success(res, null, "Dispute record deleted successfully");
  } catch (err) {
    next(err);
  }
});

export default router;

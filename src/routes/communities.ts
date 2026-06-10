import { Router, Request, Response, NextFunction } from "express";
import z from "zod";
import { AppDataSource } from "../config/database";
import { Community } from "../entities/Community";
import { success, AppError } from "../utils/response";
import { authMiddleware, requireRoles } from "../middlewares/auth";
import { ROLES } from "../config";

const router = Router();

const communityCreateSchema = z.object({
  name: z.string().min(1, "Name is required"),
  code: z.string().min(1, "Code is required"),
  streetName: z.string().optional(),
  address: z.string().optional(),
  description: z.string().optional(),
  longitude: z.number().optional(),
  latitude: z.number().optional(),
});

const communityUpdateSchema = z.object({
  name: z.string().min(1, "Name is required").optional(),
  code: z.string().min(1, "Code is required").optional(),
  streetName: z.string().optional(),
  address: z.string().optional(),
  description: z.string().optional(),
  longitude: z.number().optional(),
  latitude: z.number().optional(),
  isActive: z.boolean().optional(),
});

router.get("/", authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { page = 1, pageSize = 10, keyword, all } = req.query;
    const communityRepo = AppDataSource.getRepository(Community);

    let queryBuilder = communityRepo.createQueryBuilder("c")
      .leftJoinAndSelect("c.gridAreas", "g");

    if (keyword) {
      queryBuilder = queryBuilder.where("c.name LIKE :kw OR c.code LIKE :kw OR c.address LIKE :kw", { kw: `%${keyword}%` });
    }

    if (String(all) === "true") {
      const communities = await queryBuilder
        .andWhere("c.isActive = :active", { active: true })
        .orderBy("c.code", "ASC")
        .getMany();
      return success(res, communities, "Communities retrieved successfully");
    }

    const total = await queryBuilder.getCount();
    const communities = await queryBuilder
      .skip((Number(page) - 1) * Number(pageSize))
      .take(Number(pageSize))
      .orderBy("c.createdAt", "DESC")
      .getMany();

    success(res, communities, "Communities retrieved successfully", {
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
    const communityRepo = AppDataSource.getRepository(Community);
    const community = await communityRepo.findOne({
      where: { id: req.params.id },
      relations: ["gridAreas"],
    });

    if (!community) {
      throw new AppError("Community not found", 404, 404);
    }

    success(res, community, "Community retrieved successfully");
  } catch (err) {
    next(err);
  }
});

router.post("/", authMiddleware, requireRoles(ROLES.ADMIN, ROLES.STREET), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = communityCreateSchema.parse(req.body);
    const communityRepo = AppDataSource.getRepository(Community);

    const existing = await communityRepo.findOne({ where: { code: data.code } });
    if (existing) {
      throw new AppError("Community code already exists", 400, 400);
    }

    const community = communityRepo.create({
      ...data,
      isActive: true,
    });
    await communityRepo.save(community);

    success(res, community, "Community created successfully");
  } catch (err) {
    next(err);
  }
});

router.put("/:id", authMiddleware, requireRoles(ROLES.ADMIN, ROLES.STREET), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = communityUpdateSchema.parse(req.body);
    const communityRepo = AppDataSource.getRepository(Community);

    const community = await communityRepo.findOne({ where: { id: req.params.id } });
    if (!community) {
      throw new AppError("Community not found", 404, 404);
    }

    if (data.code && data.code !== community.code) {
      const existing = await communityRepo.findOne({ where: { code: data.code } });
      if (existing) {
        throw new AppError("Community code already exists", 400, 400);
      }
    }

    Object.assign(community, data);
    await communityRepo.save(community);

    success(res, community, "Community updated successfully");
  } catch (err) {
    next(err);
  }
});

router.delete("/:id", authMiddleware, requireRoles(ROLES.ADMIN), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const communityRepo = AppDataSource.getRepository(Community);
    const community = await communityRepo.findOne({ where: { id: req.params.id } });

    if (!community) {
      throw new AppError("Community not found", 404, 404);
    }

    community.isActive = false;
    await communityRepo.save(community);

    success(res, null, "Community disabled successfully");
  } catch (err) {
    next(err);
  }
});

export default router;

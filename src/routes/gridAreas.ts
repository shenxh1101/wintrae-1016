import { Router, Request, Response, NextFunction } from "express";
import z from "zod";
import { AppDataSource } from "../config/database";
import { GridArea } from "../entities/GridArea";
import { success, AppError } from "../utils/response";
import { authMiddleware, requireRoles } from "../middlewares/auth";
import { ROLES } from "../config";

const router = Router();

const gridAreaCreateSchema = z.object({
  name: z.string().min(1, "Name is required"),
  code: z.string().min(1, "Code is required"),
  communityId: z.string().min(1, "Community ID is required"),
  boundary: z.string().optional(),
  areaSize: z.number().optional(),
  householdCount: z.number().optional(),
  populationCount: z.number().optional(),
  gridWorkerId: z.string().optional(),
  description: z.string().optional(),
});

const gridAreaUpdateSchema = z.object({
  name: z.string().min(1, "Name is required").optional(),
  code: z.string().min(1, "Code is required").optional(),
  communityId: z.string().optional(),
  boundary: z.string().optional(),
  areaSize: z.number().optional(),
  householdCount: z.number().optional(),
  populationCount: z.number().optional(),
  gridWorkerId: z.string().optional(),
  description: z.string().optional(),
  isActive: z.boolean().optional(),
});

router.get("/", authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { page = 1, pageSize = 10, keyword, communityId, all } = req.query;
    const gridAreaRepo = AppDataSource.getRepository(GridArea);

    let queryBuilder = gridAreaRepo.createQueryBuilder("g")
      .leftJoinAndSelect("g.community", "c");

    if (keyword) {
      queryBuilder = queryBuilder.where("g.name LIKE :kw OR g.code LIKE :kw", { kw: `%${keyword}%` });
    }

    if (communityId) {
      queryBuilder = queryBuilder.andWhere("g.communityId = :cid", { cid: communityId });
    }

    if (String(all) === "true") {
      const gridAreas = await queryBuilder
        .andWhere("g.isActive = :active", { active: true })
        .orderBy("g.code", "ASC")
        .getMany();
      return success(res, gridAreas, "Grid areas retrieved successfully");
    }

    const total = await queryBuilder.getCount();
    const gridAreas = await queryBuilder
      .skip((Number(page) - 1) * Number(pageSize))
      .take(Number(pageSize))
      .orderBy("g.createdAt", "DESC")
      .getMany();

    success(res, gridAreas, "Grid areas retrieved successfully", {
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
    const gridAreaRepo = AppDataSource.getRepository(GridArea);
    const gridArea = await gridAreaRepo.findOne({
      where: { id: req.params.id },
      relations: ["community"],
    });

    if (!gridArea) {
      throw new AppError("Grid area not found", 404, 404);
    }

    success(res, gridArea, "Grid area retrieved successfully");
  } catch (err) {
    next(err);
  }
});

router.post("/", authMiddleware, requireRoles(ROLES.ADMIN, ROLES.STREET, ROLES.COMMUNITY), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = gridAreaCreateSchema.parse(req.body);
    const gridAreaRepo = AppDataSource.getRepository(GridArea);

    const existing = await gridAreaRepo.findOne({ where: { code: data.code } });
    if (existing) {
      throw new AppError("Grid area code already exists", 400, 400);
    }

    const gridArea = gridAreaRepo.create({
      ...data,
      isActive: true,
    });
    await gridAreaRepo.save(gridArea);

    success(res, gridArea, "Grid area created successfully");
  } catch (err) {
    next(err);
  }
});

router.put("/:id", authMiddleware, requireRoles(ROLES.ADMIN, ROLES.STREET, ROLES.COMMUNITY), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = gridAreaUpdateSchema.parse(req.body);
    const gridAreaRepo = AppDataSource.getRepository(GridArea);

    const gridArea = await gridAreaRepo.findOne({ where: { id: req.params.id } });
    if (!gridArea) {
      throw new AppError("Grid area not found", 404, 404);
    }

    if (data.code && data.code !== gridArea.code) {
      const existing = await gridAreaRepo.findOne({ where: { code: data.code } });
      if (existing) {
        throw new AppError("Grid area code already exists", 400, 400);
      }
    }

    Object.assign(gridArea, data);
    await gridAreaRepo.save(gridArea);

    success(res, gridArea, "Grid area updated successfully");
  } catch (err) {
    next(err);
  }
});

router.delete("/:id", authMiddleware, requireRoles(ROLES.ADMIN, ROLES.STREET), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const gridAreaRepo = AppDataSource.getRepository(GridArea);
    const gridArea = await gridAreaRepo.findOne({ where: { id: req.params.id } });

    if (!gridArea) {
      throw new AppError("Grid area not found", 404, 404);
    }

    gridArea.isActive = false;
    await gridAreaRepo.save(gridArea);

    success(res, null, "Grid area disabled successfully");
  } catch (err) {
    next(err);
  }
});

export default router;

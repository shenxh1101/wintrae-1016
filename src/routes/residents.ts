import { Router, Request, Response, NextFunction } from "express";
import z from "zod";
import { AppDataSource } from "../config/database";
import { Resident } from "../entities/Resident";
import { success, AppError } from "../utils/response";
import { authMiddleware, requireRoles } from "../middlewares/auth";
import { ROLES, RESIDENT_TAGS } from "../config";

const router = Router();

const residentCreateSchema = z.object({
  name: z.string().min(1, "Name is required"),
  idCard: z.string().optional(),
  gender: z.enum(["男", "女"]).optional(),
  age: z.number().optional(),
  phone: z.string().optional(),
  communityId: z.string().optional(),
  gridAreaId: z.string().optional(),
  address: z.string().optional(),
  buildingNo: z.string().optional(),
  roomNo: z.string().optional(),
  tags: z.array(z.enum([...RESIDENT_TAGS] as any)).optional(),
  isKeyPerson: z.boolean().optional(),
  keyPersonReason: z.string().optional(),
  remark: z.string().optional(),
});

const residentUpdateSchema = z.object({
  name: z.string().min(1, "Name is required").optional(),
  idCard: z.string().optional(),
  gender: z.enum(["男", "女"]).optional(),
  age: z.number().optional(),
  phone: z.string().optional(),
  communityId: z.string().optional(),
  gridAreaId: z.string().optional(),
  address: z.string().optional(),
  buildingNo: z.string().optional(),
  roomNo: z.string().optional(),
  tags: z.array(z.enum([...RESIDENT_TAGS] as any)).optional(),
  isKeyPerson: z.boolean().optional(),
  keyPersonReason: z.string().optional(),
  remark: z.string().optional(),
});

router.get("/", authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { page = 1, pageSize = 10, keyword, communityId, gridAreaId, isKeyPerson, tag } = req.query;
    const residentRepo = AppDataSource.getRepository(Resident);

    let queryBuilder = residentRepo.createQueryBuilder("r")
      .leftJoinAndSelect("r.community", "c")
      .leftJoinAndSelect("r.gridArea", "g");

    if (keyword) {
      queryBuilder = queryBuilder.where("r.name LIKE :kw OR r.phone LIKE :kw OR r.idCard LIKE :kw", { kw: `%${keyword}%` });
    }

    if (communityId) {
      queryBuilder = queryBuilder.andWhere("r.communityId = :cid", { cid: communityId });
    }

    if (gridAreaId) {
      queryBuilder = queryBuilder.andWhere("r.gridAreaId = :gid", { gid: gridAreaId });
    }

    if (isKeyPerson !== undefined && isKeyPerson !== null) {
      const isKey = String(isKeyPerson) === "true";
      queryBuilder = queryBuilder.andWhere("r.isKeyPerson = :ikp", { ikp: isKey });
    }

    const total = await queryBuilder.getCount();
    let residents = await queryBuilder
      .skip((Number(page) - 1) * Number(pageSize))
      .take(Number(pageSize))
      .orderBy("r.createdAt", "DESC")
      .getMany();

    if (tag) {
      residents = residents.filter((r: any) => r.tags && r.tags.includes(tag));
      const filteredTotal = residents.length;
      return success(res, residents, "Residents retrieved successfully", {
        total: filteredTotal,
        page: Number(page),
        pageSize: Number(pageSize),
      });
    }

    success(res, residents, "Residents retrieved successfully", {
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
    const residentRepo = AppDataSource.getRepository(Resident);
    const resident = await residentRepo.findOne({
      where: { id: req.params.id },
      relations: ["community", "gridArea"],
    });

    if (!resident) {
      throw new AppError("Resident not found", 404, 404);
    }

    success(res, resident, "Resident retrieved successfully");
  } catch (err) {
    next(err);
  }
});

router.post("/", authMiddleware, requireRoles(ROLES.ADMIN, ROLES.STREET, ROLES.COMMUNITY, ROLES.GRID_WORKER), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = residentCreateSchema.parse(req.body);
    const residentRepo = AppDataSource.getRepository(Resident);

    const resident = residentRepo.create({
      ...data,
      isKeyPerson: data.isKeyPerson || false,
    });
    await residentRepo.save(resident);

    success(res, resident, "Resident created successfully");
  } catch (err) {
    next(err);
  }
});

router.put("/:id", authMiddleware, requireRoles(ROLES.ADMIN, ROLES.STREET, ROLES.COMMUNITY, ROLES.GRID_WORKER), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = residentUpdateSchema.parse(req.body);
    const residentRepo = AppDataSource.getRepository(Resident);

    const resident = await residentRepo.findOne({ where: { id: req.params.id } });
    if (!resident) {
      throw new AppError("Resident not found", 404, 404);
    }

    Object.assign(resident, data);
    await residentRepo.save(resident);

    success(res, resident, "Resident updated successfully");
  } catch (err) {
    next(err);
  }
});

router.delete("/:id", authMiddleware, requireRoles(ROLES.ADMIN, ROLES.STREET, ROLES.COMMUNITY), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const residentRepo = AppDataSource.getRepository(Resident);
    const resident = await residentRepo.findOne({ where: { id: req.params.id } });

    if (!resident) {
      throw new AppError("Resident not found", 404, 404);
    }

    await residentRepo.remove(resident);

    success(res, null, "Resident deleted successfully");
  } catch (err) {
    next(err);
  }
});

export default router;

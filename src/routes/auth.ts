import { Router, Request, Response, NextFunction } from "express";
const bcrypt = require("bcryptjs");
import z from "zod";
import { AppDataSource } from "../config/database";
import { User } from "../entities/User";
import { success, fail, AppError } from "../utils/response";
import { authMiddleware, generateToken, requireRoles } from "../middlewares/auth";
import { ROLES } from "../config";

const router = Router();

const loginSchema = z.object({
  username: z.string().min(1, "Username is required"),
  password: z.string().min(1, "Password is required"),
});

const changePasswordSchema = z.object({
  oldPassword: z.string().min(1, "Old password is required"),
  newPassword: z.string().min(6, "New password must be at least 6 characters"),
});

const userCreateSchema = z.object({
  username: z.string().min(3, "Username must be at least 3 characters"),
  password: z.string().min(6, "Password must be at least 6 characters"),
  realName: z.string().min(1, "Real name is required"),
  role: z.enum([ROLES.ADMIN, ROLES.STREET, ROLES.COMMUNITY, ROLES.GRID_WORKER, ROLES.UPPER_PLATFORM]),
  phone: z.string().optional(),
  idCard: z.string().optional(),
  communityId: z.string().optional(),
  gridAreaId: z.string().optional(),
});

const userUpdateSchema = z.object({
  realName: z.string().min(1, "Real name is required").optional(),
  role: z.enum([ROLES.ADMIN, ROLES.STREET, ROLES.COMMUNITY, ROLES.GRID_WORKER, ROLES.UPPER_PLATFORM]).optional(),
  phone: z.string().optional(),
  idCard: z.string().optional(),
  communityId: z.string().optional(),
  gridAreaId: z.string().optional(),
  isActive: z.boolean().optional(),
});

router.post("/login", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = loginSchema.parse(req.body);
    const userRepo = AppDataSource.getRepository(User);
    const user = await userRepo.findOne({
      where: { username: data.username },
      relations: ["community", "gridArea"],
    });

    if (!user) {
      throw new AppError("Invalid username or password", 401, 401);
    }

    if (!user.isActive) {
      throw new AppError("Account has been disabled", 403, 403);
    }

    const isValid = await bcrypt.compare(data.password, user.password);
    if (!isValid) {
      throw new AppError("Invalid username or password", 401, 401);
    }

    const token = generateToken(user);
    const { password, ...userInfo } = user;

    success(res, {
      token,
      user: userInfo,
    }, "Login successful");
  } catch (err) {
    next(err);
  }
});

router.get("/profile", authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userRepo = AppDataSource.getRepository(User);
    const user = await userRepo.findOne({
      where: { id: req.user!.userId },
      relations: ["community", "gridArea"],
    });

    if (!user) {
      throw new AppError("User not found", 404, 404);
    }

    const { password, ...userInfo } = user;
    success(res, userInfo, "Profile retrieved successfully");
  } catch (err) {
    next(err);
  }
});

router.post("/change-password", authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = changePasswordSchema.parse(req.body);
    const userRepo = AppDataSource.getRepository(User);
    const user = await userRepo.findOne({ where: { id: req.user!.userId } });

    if (!user) {
      throw new AppError("User not found", 404, 404);
    }

    const isValid = await bcrypt.compare(data.oldPassword, user.password);
    if (!isValid) {
      throw new AppError("Old password is incorrect", 400, 400);
    }

    user.password = await bcrypt.hash(data.newPassword, 10);
    await userRepo.save(user);

    success(res, null, "Password changed successfully");
  } catch (err) {
    next(err);
  }
});

router.get("/users", authMiddleware, requireRoles(ROLES.ADMIN, ROLES.STREET), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { page = 1, pageSize = 10, keyword, role, communityId } = req.query;
    const userRepo = AppDataSource.getRepository(User);

    let queryBuilder = userRepo.createQueryBuilder("u")
      .leftJoinAndSelect("u.community", "c")
      .leftJoinAndSelect("u.gridArea", "g");

    if (keyword) {
      queryBuilder = queryBuilder.where("u.username LIKE :kw OR u.realName LIKE :kw OR u.phone LIKE :kw", { kw: `%${keyword}%` });
    }

    if (role) {
      queryBuilder = queryBuilder.andWhere("u.role = :role", { role });
    }

    if (communityId) {
      queryBuilder = queryBuilder.andWhere("u.communityId = :cid", { cid: communityId });
    }

    const total = await queryBuilder.getCount();
    const users = await queryBuilder
      .skip((Number(page) - 1) * Number(pageSize))
      .take(Number(pageSize))
      .orderBy("u.createdAt", "DESC")
      .getMany();

    const cleanUsers = users.map(({ password, ...rest }) => rest);

    success(res, cleanUsers, "Users retrieved successfully", {
      total,
      page: Number(page),
      pageSize: Number(pageSize),
    });
  } catch (err) {
    next(err);
  }
});

router.post("/users", authMiddleware, requireRoles(ROLES.ADMIN, ROLES.STREET), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = userCreateSchema.parse(req.body);
    const userRepo = AppDataSource.getRepository(User);

    const existing = await userRepo.findOne({ where: { username: data.username } });
    if (existing) {
      throw new AppError("Username already exists", 400, 400);
    }

    const hashedPwd = await bcrypt.hash(data.password, 10);
    const user = userRepo.create({
      ...data,
      password: hashedPwd,
      isActive: true,
    });
    await userRepo.save(user);

    const { password, ...userInfo } = user;
    success(res, userInfo, "User created successfully");
  } catch (err) {
    next(err);
  }
});

router.put("/users/:id", authMiddleware, requireRoles(ROLES.ADMIN, ROLES.STREET), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = userUpdateSchema.parse(req.body);
    const userRepo = AppDataSource.getRepository(User);

    const user = await userRepo.findOne({ where: { id: req.params.id } });
    if (!user) {
      throw new AppError("User not found", 404, 404);
    }

    Object.assign(user, data);
    await userRepo.save(user);

    const { password, ...userInfo } = user;
    success(res, userInfo, "User updated successfully");
  } catch (err) {
    next(err);
  }
});

router.delete("/users/:id", authMiddleware, requireRoles(ROLES.ADMIN), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userRepo = AppDataSource.getRepository(User);
    const user = await userRepo.findOne({ where: { id: req.params.id } });

    if (!user) {
      throw new AppError("User not found", 404, 404);
    }

    if (user.username === "admin") {
      throw new AppError("Cannot delete super administrator", 400, 400);
    }

    user.isActive = false;
    await userRepo.save(user);

    success(res, null, "User disabled successfully");
  } catch (err) {
    next(err);
  }
});

export default router;

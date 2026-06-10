import { Request, Response, NextFunction } from "express";
const jwt = require("jsonwebtoken");
import { JWT_SECRET, ROLES, RoleType } from "../config";
import { AppError } from "../utils/response";
import { AppDataSource } from "../config/database";
import { User } from "../entities/User";

export interface AuthPayload {
  userId: string;
  username: string;
  role: RoleType;
  realName: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthPayload & { userEntity?: User };
    }
  }
}

export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      throw new AppError("未登录或Token已失效", 401, 401);
    }

    const token = authHeader.slice(7);
    const decoded = jwt.verify(token, JWT_SECRET) as AuthPayload;

    const userRepo = AppDataSource.getRepository(User);
    const user = await userRepo.findOne({
      where: { id: decoded.userId, isActive: true },
      relations: ["community", "gridArea"],
    });

    if (!user) {
      throw new AppError("用户不存在或已被禁用", 401, 401);
    }

    req.user = {
      ...decoded,
      userEntity: user,
    };

    next();
  } catch (err) {
    if (err instanceof AppError) {
      return next(err);
    }
    if ((err as any).name === "TokenExpiredError") {
      return next(new AppError("登录已过期，请重新登录", 401, 401));
    }
    if ((err as any).name === "JsonWebTokenError") {
      return next(new AppError("Token无效", 401, 401));
    }
    next(err);
  }
}

export function requireRoles(...roles: RoleType[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return next(new AppError("未登录", 401, 401));
    }
    if (!roles.includes(req.user.role)) {
      return next(new AppError("无权限执行此操作", 403, 403));
    }
    next();
  };
}

export function generateToken(user: User): string {
  const payload: AuthPayload = {
    userId: user.id,
    username: user.username,
    role: user.role as RoleType,
    realName: user.realName,
  };
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "24h" });
}

import { Response, Request, NextFunction } from "express";

export interface ApiResponse<T = any> {
  code: number;
  message: string;
  data?: T;
  total?: number;
  page?: number;
  pageSize?: number;
}

export function success<T = any>(
  res: Response,
  data?: T,
  message = "操作成功",
  pagination?: { total: number; page: number; pageSize: number }
): Response<ApiResponse<T>> {
  const response: ApiResponse<T> = {
    code: 0,
    message,
    data,
  };
  if (pagination) {
    response.total = pagination.total;
    response.page = pagination.page;
    response.pageSize = pagination.pageSize;
  }
  return res.json(response);
}

export function fail(
  res: Response,
  message = "操作失败",
  code = 1,
  statusCode = 400
): Response<ApiResponse> {
  return res.status(statusCode).json({
    code,
    message,
  });
}

export class AppError extends Error {
  public code: number;
  public statusCode: number;

  constructor(message: string, code = 1, statusCode = 400) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
    this.name = "AppError";
  }

  static throwValidationError(zodErr: any): never {
    const messages = zodErr.issues?.map((i: any) => `${i.path.join(".")}: ${i.message}`).join("; ") || "Validation failed";
    throw new AppError(messages, 400, 400);
  }

  static throwNotFound(message = "Resource not found"): never {
    throw new AppError(message, 404, 404);
  }

  static throwForbidden(message = "No permission"): never {
    throw new AppError(message, 403, 403);
  }

  static throwUnauthorized(message = "Unauthorized"): never {
    throw new AppError(message, 401, 401);
  }
}

export function errorHandler(
  err: any,
  req: Request,
  res: Response,
  next: NextFunction
) {
  console.error("[Error]", err);

  if (err instanceof AppError) {
    return fail(res, err.message, err.code, err.statusCode);
  }

  if (err.name === "ZodError") {
    const messages = err.issues.map((i: any) => `${i.path.join(".")}: ${i.message}`).join("; ");
    return fail(res, `参数校验失败: ${messages}`, 400, 400);
  }

  if (err.code === "SQLITE_CONSTRAINT") {
    return fail(res, "数据约束冲突，可能存在重复数据", 500, 400);
  }

  return fail(res, err.message || "服务器内部错误", 500, 500);
}

export function notFoundHandler(
  req: Request,
  res: Response,
  next: NextFunction
) {
  return fail(res, `接口不存在: ${req.method} ${req.path}`, 404, 404);
}

import { Router, Request, Response, NextFunction } from "express";
import * as fs from "fs";
import * as path from "path";
import dayjs from "dayjs";
import { v4 as uuidv4 } from "uuid";
import { AppDataSource } from "../config/database";
import { Event } from "../entities/Event";
import { Community } from "../entities/Community";
import { GridArea } from "../entities/GridArea";
import { ExportTask } from "../entities/ExportTask";
import { success, AppError } from "../utils/response";
import { authMiddleware, requireRoles } from "../middlewares/auth";
import { ROLES, EVENT_STATUS } from "../config";

const router = Router();

const EXPORT_DIR = path.resolve(__dirname, "../../data/exports");
if (!fs.existsSync(EXPORT_DIR)) fs.mkdirSync(EXPORT_DIR, { recursive: true });

function buildExportQueryBuilder(eventRepo: any, params: any) {
  const { communityId, gridAreaId, eventType, status, isOverdue, isRepeated, gridWorkerId, startDate, endDate, sourcePlatform } = params;
  let builder = eventRepo.createQueryBuilder("e");
  if (communityId) builder = builder.where("e.communityId = :cid", { cid: communityId });
  if (gridAreaId) builder = builder.andWhere("e.gridAreaId = :gid", { gid: gridAreaId });
  if (eventType) builder = builder.andWhere("e.eventType = :et", { et: eventType });
  if (status) builder = builder.andWhere("e.status = :st", { st: status });
  if (isOverdue !== undefined) builder = builder.andWhere("e.isOverdue = :io", { io: isOverdue === "true" });
  if (isRepeated !== undefined) builder = builder.andWhere("e.isRepeated = :ir", { ir: isRepeated === "true" });
  if (sourcePlatform) builder = builder.andWhere("e.source = :sp", { sp: sourcePlatform });
  if (gridWorkerId) builder = builder.andWhere("(e.reporterId = :gwid OR e.assigneeId = :gwid)", { gwid: gridWorkerId });
  if (startDate) builder = builder.andWhere("e.createdAt >= :sd", { sd: new Date(startDate as string) });
  if (endDate) builder = builder.andWhere("e.createdAt <= :ed", { ed: new Date(endDate + "T23:59:59") });
  return builder.orderBy("e.createdAt", "DESC");
}

function buildCsvContent(events: any[], communities: any[], grids: any[]) {
  const communityCache = new Map<string, string>();
  const gridCache = new Map<string, string>();
  for (const c of communities) communityCache.set(c.id, c.name);
  for (const g of grids) gridCache.set(g.id, g.name);

  const fmt = (d: any) => d ? dayjs(d).format("YYYY-MM-DD HH:mm:ss") : "";
  const csvEscape = (s: any) => {
    const v = s === null || s === undefined ? "" : String(s);
    if (v.includes(",") || v.includes("\"") || v.includes("\n")) return `"${v.replace(/"/g, '""')}"`;
    return v;
  };

  const statusMap: any = {
    pending: "待派单", assigned: "已派单", processing: "处理中", feedback: "待反馈",
    revisiting: "回访中", completed: "已完成", closed: "已结案", overdue: "已超时",
  };

  const headers = [
    "事件编号", "标题", "社区", "网格", "事件类型", "事件等级",
    "状态", "上报人", "处理人", "是否超时", "是否重复",
    "来源平台", "创建时间", "派单时间", "完成时间", "截止时间",
  ];

  const rows = events.map((e: any) => [
    e.eventNo, e.title,
    communityCache.get(e.communityId) || "",
    gridCache.get(e.gridAreaId) || "",
    e.eventType, e.priority || "",
    statusMap[e.status] || e.status,
    e.reporterName || "", e.assigneeName || "",
    e.isOverdue ? "是" : "否", e.isRepeated ? "是" : "否", e.source || "",
    fmt(e.createdAt), fmt(e.assignedAt), fmt(e.completedAt), fmt(e.deadline),
  ]);

  return [headers, ...rows].map(r => r.map(csvEscape).join(",")).join("\n");
}

function buildTaskName(filters: any) {
  const parts: string[] = ["事件清单"];
  const keys: [string, string][] = [
    ["sourcePlatform", "来源"], ["communityId", "社区"], ["gridAreaId", "网格"],
    ["gridWorkerId", "网格员"], ["eventType", "类型"], ["status", "状态"],
    ["isOverdue", "超时"], ["startDate", "起"], ["endDate", "止"],
  ];
  for (const [k, label] of keys) {
    if (filters[k] !== undefined && filters[k] !== null && filters[k] !== "") {
      parts.push(`${label}${filters[k]}`);
    }
  }
  parts.push(dayjs().format("YYYYMMDD_HHmmss"));
  return parts.join("_");
}

async function generateExport(task: any) {
  const eventRepo = AppDataSource.getRepository(Event);
  const communityRepo = AppDataSource.getRepository(Community);
  const gridRepo = AppDataSource.getRepository(GridArea);
  const taskRepo = AppDataSource.getRepository(ExportTask);

  try {
    task.status = "processing";
    task.startedAt = new Date();
    await taskRepo.save(task);

    const events = await buildExportQueryBuilder(eventRepo, task.filters).getMany();
    const communities = await communityRepo.find();
    const grids = await gridRepo.find();
    const csv = buildCsvContent(events as any[], communities as any[], grids as any[]);
    const bom = "\uFEFF";
    const fileName = task.fileName;
    const filePath = path.join(EXPORT_DIR, fileName);
    fs.writeFileSync(filePath, bom + csv, "utf-8");

    task.recordCount = events.length;
    task.fileSize = fs.statSync(filePath).size;
    task.status = "completed";
    task.completedAt = new Date();
    await taskRepo.save(task);
    return task;
  } catch (err: any) {
    task.status = "failed";
    task.errorMessage = err && err.message ? err.message : String(err);
    task.completedAt = new Date();
    await taskRepo.save(task);
    return task;
  }
}

router.get("/", authMiddleware, requireRoles(ROLES.ADMIN, ROLES.STREET, ROLES.COMMUNITY, ROLES.UPPER_PLATFORM), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const taskRepo = AppDataSource.getRepository(ExportTask);
    const { page = 1, pageSize = 20, status, taskType } = req.query;

    let builder = taskRepo.createQueryBuilder("t").where("t.userId = :uid", { uid: req.user!.userId });
    if (status) builder = builder.andWhere("t.status = :st", { st: status });
    if (taskType) builder = builder.andWhere("t.taskType = :tt", { tt: taskType });

    const total = await builder.getCount();
    const list = await builder.skip((Number(page) - 1) * Number(pageSize))
      .take(Number(pageSize)).orderBy("t.createdAt", "DESC").getMany();

    success(res, list, "Export task list retrieved successfully", {
      total, page: Number(page), pageSize: Number(pageSize),
    });
  } catch (err) {
    next(err);
  }
});

router.post("/create-events-export", authMiddleware, requireRoles(ROLES.ADMIN, ROLES.STREET, ROLES.COMMUNITY, ROLES.UPPER_PLATFORM), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const taskRepo = AppDataSource.getRepository(ExportTask);
    const filters = req.body || {};
    const taskName = buildTaskName(filters);
    const fileName = `${uuidv4()}.csv`;

    const task = taskRepo.create({
      userId: req.user!.userId,
      taskName,
      taskType: "events",
      status: "pending",
      filters,
      fileName,
      createdAt: new Date(),
    });
    const saved = await taskRepo.save(task);

    setImmediate(() => generateExport(saved));

    success(res, saved, "Export task created successfully");
  } catch (err) {
    next(err);
  }
});

router.get("/:id", authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const taskRepo = AppDataSource.getRepository(ExportTask);
    const task = await taskRepo.findOne({ where: { id: req.params.id } });
    if (!task) return AppError.throwNotFound("Export task not found");
    if ((task as any).userId !== req.user!.userId) {
      throw new AppError("No permission to view this task", 403, 403);
    }
    success(res, task, "Export task retrieved successfully");
  } catch (err) {
    next(err);
  }
});

router.get("/:id/download", authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const taskRepo = AppDataSource.getRepository(ExportTask);
    const task = await taskRepo.findOne({ where: { id: req.params.id } });
    if (!task) return AppError.throwNotFound("Export task not found");
    if ((task as any).userId !== req.user!.userId) {
      throw new AppError("No permission to download this task", 403, 403);
    }
    if ((task as any).status !== "completed") {
      throw new AppError(`Task is not ready: status=${(task as any).status}`, 400, 400);
    }

    const downloadName = `${(task as any).taskName || "export"}.csv`;
    const filePath = path.join(EXPORT_DIR, (task as any).fileName!);
    if (!fs.existsSync(filePath)) {
      throw new AppError("Export file not found, please retry export", 404, 404);
    }

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(downloadName)}"`);
    fs.createReadStream(filePath).pipe(res);
  } catch (err) {
    next(err);
  }
});

router.post("/:id/retry", authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const taskRepo = AppDataSource.getRepository(ExportTask);
    const task = await taskRepo.findOne({ where: { id: req.params.id } });
    if (!task) return AppError.throwNotFound("Export task not found");
    if ((task as any).userId !== req.user!.userId) {
      throw new AppError("No permission to retry this task", 403, 403);
    }

    const filters = (task as any).filters || {};
    const newFileName = `${uuidv4()}.csv`;
    const newTask = taskRepo.create({
      userId: req.user!.userId,
      taskName: `${(task as any).taskName || "导出"}_retry_${dayjs().format("YYYYMMDD_HHmmss")}`,
      taskType: (task as any).taskType || "events",
      status: "pending",
      filters,
      fileName: newFileName,
      createdAt: new Date(),
    });
    const saved = await taskRepo.save(newTask);

    setImmediate(() => generateExport(saved));

    success(res, saved, "Export task retried successfully");
  } catch (err) {
    next(err);
  }
});

router.delete("/:id", authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const taskRepo = AppDataSource.getRepository(ExportTask);
    const task = await taskRepo.findOne({ where: { id: req.params.id } });
    if (!task) return AppError.throwNotFound("Export task not found");
    if ((task as any).userId !== req.user!.userId) {
      throw new AppError("No permission to delete this task", 403, 403);
    }

    if ((task as any).fileName) {
      const filePath = path.join(EXPORT_DIR, (task as any).fileName);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }

    await taskRepo.remove(task);
    success(res, null, "Export task deleted successfully");
  } catch (err) {
    next(err);
  }
});

export default router;

import { Router, Request, Response, NextFunction } from "express";
import * as path from "path";
import * as fs from "fs";
const multer = require("multer");
import { v4 as uuidv4 } from "uuid";
import z from "zod";
import { AppDataSource } from "../config/database";
import { Attachment } from "../entities/Attachment";
import { success, AppError } from "../utils/response";
import { authMiddleware, requireRoles } from "../middlewares/auth";
import { ROLES } from "../config";

const router = Router();

const BIZ_TYPES = [
  "event",
  "visit",
  "dispute",
  "resident",
  "user_avatar",
  "community",
  "grid_area",
] as const;

const uploadsDir = path.resolve(__dirname, "../../uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req: any, file: any, cb: any) => {
    const bizType = req.body.bizType || "general";
    const bizDir = path.join(uploadsDir, bizType);
    if (!fs.existsSync(bizDir)) {
      fs.mkdirSync(bizDir, { recursive: true });
    }
    cb(null, bizDir);
  },
  filename: (req: any, file: any, cb: any) => {
    const ext = path.extname(file.originalname);
    const filename = `${Date.now()}-${uuidv4().substring(0, 8)}${ext}`;
    cb(null, filename);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024,
  },
  fileFilter: (req: any, file: any, cb: any) => {
    const allowedExts = [
      ".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp",
      ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".ppt",
      ".txt", ".zip", ".rar", ".mp4", ".mp3",
    ];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedExts.includes(ext)) {
      cb(null, true);
    } else {
      cb(new AppError("Unsupported file type", 400, 400));
    }
  },
});

const attachmentQuerySchema = z.object({
  bizType: z.enum([...BIZ_TYPES] as any),
  bizId: z.string().min(1, "Business ID is required"),
});

router.get("/", authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { bizType, bizId } = attachmentQuerySchema.parse(req.query);
    const attachmentRepo = AppDataSource.getRepository(Attachment);

    const attachments = await attachmentRepo.find({
      where: {
        bizType,
        bizId,
      },
      order: { createdAt: "ASC" },
    });

    success(res, attachments, "Attachments retrieved successfully");
  } catch (err) {
    next(err);
  }
});

router.get("/:id", authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const attachmentRepo = AppDataSource.getRepository(Attachment);
    const attachment = await attachmentRepo.findOne({ where: { id: req.params.id } });

    if (!attachment) {
      throw new AppError("Attachment not found", 404, 404);
    }

    success(res, attachment, "Attachment retrieved successfully");
  } catch (err) {
    next(err);
  }
});

router.post("/upload", authMiddleware, upload.array("files", 10), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { bizType, bizId } = req.body;
    const files = req.files as Express.Multer.File[];

    if (!bizType || !bizId) {
      throw new AppError("bizType and bizId are required", 400, 400);
    }

    if (!BIZ_TYPES.includes(bizType)) {
      throw new AppError(`Invalid bizType, allowed values: ${BIZ_TYPES.join(", ")}`, 400, 400);
    }

    if (!files || files.length === 0) {
      throw new AppError("No files uploaded", 400, 400);
    }

    const attachmentRepo = AppDataSource.getRepository(Attachment);
    const attachments: any[] = [];

    for (const file of files) {
      const filePath = path.relative(path.resolve(__dirname, "../.."), file.path).replace(/\\/g, "/");

      const attachment = attachmentRepo.create({
        originalName: file.originalname,
        fileName: file.filename,
        filePath: `/${filePath}`,
        fileSize: file.size,
        mimeType: file.mimetype,
        bizType,
        bizId,
        uploaderId: req.user!.userId,
      });
      await attachmentRepo.save(attachment);
      attachments.push(attachment);
    }

    success(res, attachments, "Files uploaded successfully");
  } catch (err) {
    next(err);
  }
});

router.delete("/:id", authMiddleware, requireRoles(ROLES.ADMIN, ROLES.STREET, ROLES.COMMUNITY, ROLES.GRID_WORKER), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const attachmentRepo = AppDataSource.getRepository(Attachment);
    const attachment = await attachmentRepo.findOne({ where: { id: req.params.id } });

    if (!attachment) {
      throw new AppError("Attachment not found", 404, 404);
    }

    if (attachment.uploaderId !== req.user!.userId && !["admin", "street"].includes(req.user!.role)) {
      throw new AppError("No permission to delete this attachment", 403, 403);
    }

    const fullPath = path.resolve(__dirname, "../..", attachment.filePath);
    if (fs.existsSync(fullPath)) {
      try {
        fs.unlinkSync(fullPath);
      } catch (e) {
        console.warn("[Attachment] Failed to delete file:", e);
      }
    }

    await attachmentRepo.remove(attachment);

    success(res, null, "Attachment deleted successfully");
  } catch (err) {
    next(err);
  }
});

export default router;

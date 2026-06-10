import express from "express";
import cors from "cors";
import * as path from "path";
import * as fs from "fs";
import { AppDataSource } from "./config/database";
import { PORT } from "./config";
import { errorHandler, notFoundHandler, success } from "./utils/response";

import authRoutes from "./routes/auth";
import communityRoutes from "./routes/communities";
import gridAreaRoutes from "./routes/gridAreas";
import residentRoutes from "./routes/residents";
import eventRoutes from "./routes/events";
import visitRoutes from "./routes/visits";
import disputeRoutes from "./routes/disputes";
import notificationRoutes from "./routes/notifications";
import attachmentRoutes from "./routes/attachments";
import statisticsRoutes from "./routes/statistics";
import upperPlatformRoutes from "./routes/upperPlatform";
import { startScheduledTasks, checkOverdueTasks } from "./scheduler/tasks";

async function bootstrap() {
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ extended: true, limit: "10mb" }));

  const uploadsDir = path.resolve(__dirname, "../uploads");
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }
  app.use("/uploads", express.static(uploadsDir));

  app.get("/health", (req, res) => {
    success(res, {
      status: "ok",
      timestamp: new Date().toISOString(),
      db: AppDataSource.isInitialized ? "connected" : "disconnected",
    });
  });

  app.get("/", (req, res) => {
    success(res, {
      name: "网格化管理后端服务",
      version: "1.0.0",
      description: "街道平台事件流转和人员走访能力服务",
      endpoints: {
        auth: "/api/auth",
        communities: "/api/communities",
        gridAreas: "/api/grid-areas",
        residents: "/api/residents",
        events: "/api/events",
        visits: "/api/visits",
        disputes: "/api/disputes",
        notifications: "/api/notifications",
        attachments: "/api/attachments",
        statistics: "/api/statistics",
        upperPlatform: "/api/upper-platform",
      },
      health: "/health",
    });
  });

  app.use("/api/auth", authRoutes);
  app.use("/api/communities", communityRoutes);
  app.use("/api/grid-areas", gridAreaRoutes);
  app.use("/api/residents", residentRoutes);
  app.use("/api/events", eventRoutes);
  app.use("/api/visits", visitRoutes);
  app.use("/api/disputes", disputeRoutes);
  app.use("/api/notifications", notificationRoutes);
  app.use("/api/attachments", attachmentRoutes);
  app.use("/api/statistics", statisticsRoutes);
  app.use("/api/upper-platform", upperPlatformRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  try {
    await AppDataSource.initialize();
    console.log("[数据库] SQLite 连接成功");

    startScheduledTasks();
    setTimeout(() => checkOverdueTasks(), 3000);

    app.listen(PORT, () => {
      console.log("========================================");
      console.log(`  网格化管理后端服务已启动`);
      console.log(`  服务地址: http://localhost:${PORT}`);
      console.log(`  健康检查: http://localhost:${PORT}/health`);
      console.log(`  接口文档: http://localhost:${PORT}/`);
      console.log("========================================");
      console.log("");
      console.log("默认账号（密码均为 123456）:");
      console.log("  admin       - 系统管理员");
      console.log("  street01    - 街道管理员");
      console.log("  community01 - 社区管理员");
      console.log("  worker01    - 网格员");
      console.log("  worker02    - 网格员");
      console.log("  upper01     - 上级平台用户");
      console.log("");
      console.log("如缺少初始数据，请运行: npm run seed");
    });
  } catch (err) {
    console.error("[启动失败]", err);
    process.exit(1);
  }
}

bootstrap();

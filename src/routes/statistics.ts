import { Router, Request, Response, NextFunction } from "express";
import dayjs from "dayjs";
import { AppDataSource } from "../config/database";
import { Event } from "../entities/Event";
import { VisitRecord } from "../entities/VisitRecord";
import { DisputeRecord } from "../entities/DisputeRecord";
import { Resident } from "../entities/Resident";
import { Community } from "../entities/Community";
import { GridArea } from "../entities/GridArea";
import { User } from "../entities/User";
import { success, AppError } from "../utils/response";
import { authMiddleware, requireRoles } from "../middlewares/auth";
import { ROLES, EVENT_STATUS, EVENT_TYPES, VISIT_TYPES } from "../config";

const router = Router();

router.get("/overview", authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const eventRepo = AppDataSource.getRepository(Event);
    const visitRepo = AppDataSource.getRepository(VisitRecord);
    const disputeRepo = AppDataSource.getRepository(DisputeRecord);
    const residentRepo = AppDataSource.getRepository(Resident);
    const communityRepo = AppDataSource.getRepository(Community);
    const gridAreaRepo = AppDataSource.getRepository(GridArea);
    const userRepo = AppDataSource.getRepository(User);

    const communityId = req.query.communityId as string | undefined;
    const gridAreaId = req.query.gridAreaId as string | undefined;
    const gridWorkerId = req.query.gridWorkerId as string | undefined;

    const eventWhere: any = {};
    const visitWhere: any = {};
    const disputeWhere: any = {};
    const residentWhere: any = {};

    if (communityId) {
      eventWhere.communityId = communityId;
      visitWhere.communityId = communityId;
      disputeWhere.communityId = communityId;
      residentWhere.communityId = communityId;
    }
    if (gridAreaId) {
      eventWhere.gridAreaId = gridAreaId;
      visitWhere.gridAreaId = gridAreaId;
      disputeWhere.gridAreaId = gridAreaId;
      residentWhere.gridAreaId = gridAreaId;
    }
    if (gridWorkerId) {
      visitWhere.visitorId = gridWorkerId;
    }

    const totalEvents = await eventRepo.count({ where: eventWhere });
    const pendingEvents = await eventRepo.count({ where: { ...eventWhere, status: EVENT_STATUS.PENDING } });
    const processingEvents = await eventRepo.count({ where: { ...eventWhere, status: EVENT_STATUS.PROCESSING } });
    const completedEvents = await eventRepo.count({ where: { ...eventWhere, status: EVENT_STATUS.COMPLETED } });
    const closedEvents = await eventRepo.count({ where: { ...eventWhere, status: EVENT_STATUS.CLOSED } });
    const overdueEvents = await eventRepo.count({ where: { ...eventWhere, isOverdue: true } });
    const repeatedEvents = await eventRepo.count({ where: { ...eventWhere, isRepeated: true } });

    const totalVisits = await visitRepo.count({ where: visitWhere });
    const issueVisits = await visitRepo.count({ where: { ...visitWhere, hasIssue: true } });

    const allVisits = await visitRepo.find({ where: visitWhere });
    const visitedResidentSet = new Set<string>();
    const visitedGridSet = new Set<string>();
    for (const v of allVisits as any) {
      if (v.residentId) visitedResidentSet.add(v.residentId);
      if (v.gridAreaId) visitedGridSet.add(v.gridAreaId);
    }
    const visitedResidentCount = visitedResidentSet.size;
    const visitedGridAreaCount = visitedGridSet.size;

    const totalDisputes = await disputeRepo.count({ where: disputeWhere });
    const resolvedDisputes = await disputeRepo.count({ where: { ...disputeWhere, status: "resolved" } });

    const totalResidents = await residentRepo.count({ where: residentWhere });
    const keyResidents = await residentRepo.count({ where: { ...residentWhere, isKeyPerson: true } });

    let totalCommunities = 0;
    let totalGridAreas = 0;
    if (communityId) {
      totalCommunities = (await communityRepo.count({ where: { id: communityId, isActive: true } }));
    } else {
      totalCommunities = await communityRepo.count({ where: { isActive: true } });
    }
    if (gridAreaId) {
      totalGridAreas = await gridAreaRepo.count({ where: { id: gridAreaId, isActive: true } });
    } else if (communityId) {
      totalGridAreas = await gridAreaRepo.count({ where: { communityId, isActive: true } });
    } else {
      totalGridAreas = await gridAreaRepo.count({ where: { isActive: true } });
    }
    const totalGridWorkers = await userRepo.count({ where: { role: ROLES.GRID_WORKER, isActive: true } });

    success(res, {
      events: {
        total: totalEvents,
        pending: pendingEvents,
        processing: processingEvents,
        completed: completedEvents,
        closed: closedEvents,
        overdue: overdueEvents,
        repeated: repeatedEvents,
        completionRate: totalEvents > 0 ? Math.round((completedEvents + closedEvents) / totalEvents * 100) : 0,
        overdueRate: totalEvents > 0 ? Math.round(overdueEvents / totalEvents * 100) : 0,
        repeatedRate: totalEvents > 0 ? Math.round(repeatedEvents / totalEvents * 100) : 0,
      },
      visits: {
        total: totalVisits,
        withIssue: issueVisits,
        visitedResidents: visitedResidentCount,
        visitedGridAreas: visitedGridAreaCount,
        residentCoverageRate: totalResidents > 0 ? Math.round(visitedResidentCount / totalResidents * 100) : 0,
        gridCoverageRate: totalGridAreas > 0 ? Math.round(visitedGridAreaCount / totalGridAreas * 100) : 0,
      },
      disputes: {
        total: totalDisputes,
        resolved: resolvedDisputes,
        resolutionRate: totalDisputes > 0 ? Math.round(resolvedDisputes / totalDisputes * 100) : 0,
      },
      residents: {
        total: totalResidents,
        keyPersons: keyResidents,
        visited: visitedResidentCount,
      },
      base: {
        communities: totalCommunities,
        gridAreas: totalGridAreas,
        gridWorkers: totalGridWorkers,
      },
    }, "Overview statistics retrieved successfully");
  } catch (err) {
    next(err);
  }
});

router.get("/events-by-type", authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const eventRepo = AppDataSource.getRepository(Event);
    const communityId = req.query.communityId as string | undefined;

    const result: any[] = [];
    for (const type of EVENT_TYPES) {
      const where: any = { eventType: type };
      if (communityId) {
        where.communityId = communityId;
      }
      const count = await eventRepo.count({ where });
      if (count > 0 || req.query.includeZero === "true") {
        result.push({
          type,
          count,
        });
      }
    }
    result.sort((a, b) => b.count - a.count);

    success(res, result, "Event type statistics retrieved successfully");
  } catch (err) {
    next(err);
  }
});

router.get("/events-by-status", authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const eventRepo = AppDataSource.getRepository(Event);
    const communityId = req.query.communityId as string | undefined;

    const statuses = [
      { key: EVENT_STATUS.PENDING, label: "Pending" },
      { key: EVENT_STATUS.ASSIGNED, label: "Assigned" },
      { key: EVENT_STATUS.PROCESSING, label: "Processing" },
      { key: EVENT_STATUS.FEEDBACK, label: "Feedback" },
      { key: EVENT_STATUS.REVISITING, label: "Revisiting" },
      { key: EVENT_STATUS.COMPLETED, label: "Completed" },
      { key: EVENT_STATUS.CLOSED, label: "Closed" },
      { key: EVENT_STATUS.OVERDUE, label: "Overdue" },
    ];

    const result: any[] = [];
    for (const s of statuses) {
      const where: any = { status: s.key };
      if (communityId) {
        where.communityId = communityId;
      }
      const count = await eventRepo.count({ where });
      result.push({
        status: s.key,
        label: s.label,
        count,
      });
    }

    success(res, result, "Event status statistics retrieved successfully");
  } catch (err) {
    next(err);
  }
});

router.get("/events-trend", authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const eventRepo = AppDataSource.getRepository(Event);
    const days = Number(req.query.days) || 7;
    const communityId = req.query.communityId as string | undefined;
    const gridAreaId = req.query.gridAreaId as string | undefined;

    const result: any[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const date = dayjs().subtract(i, "day");
      const startOfDay = date.startOf("day").toDate();
      const endOfDay = date.endOf("day").toDate();

      let createdBuilder = eventRepo.createQueryBuilder("e")
        .where("e.createdAt >= :start", { start: startOfDay })
        .andWhere("e.createdAt <= :end", { end: endOfDay });
      if (communityId) createdBuilder = createdBuilder.andWhere("e.communityId = :cid", { cid: communityId });
      if (gridAreaId) createdBuilder = createdBuilder.andWhere("e.gridAreaId = :gid", { gid: gridAreaId });
      const createdCount = await createdBuilder.getCount();

      let completedBuilder = eventRepo.createQueryBuilder("e")
        .where("e.completedAt IS NOT NULL")
        .andWhere("e.completedAt >= :start", { start: startOfDay })
        .andWhere("e.completedAt <= :end", { end: endOfDay });
      if (communityId) completedBuilder = completedBuilder.andWhere("e.communityId = :cid", { cid: communityId });
      if (gridAreaId) completedBuilder = completedBuilder.andWhere("e.gridAreaId = :gid", { gid: gridAreaId });
      const completedCount = await completedBuilder.getCount();

      result.push({
        date: date.format("YYYY-MM-DD"),
        created: createdCount,
        completed: completedCount,
      });
    }

    success(res, result, "Event trend statistics retrieved successfully");
  } catch (err) {
    next(err);
  }
});

router.get("/visits-by-type", authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const visitRepo = AppDataSource.getRepository(VisitRecord);
    const communityId = req.query.communityId as string | undefined;

    const result: any[] = [];
    for (const type of VISIT_TYPES) {
      const where: any = { visitType: type };
      if (communityId) {
        where.communityId = communityId;
      }
      const count = await visitRepo.count({ where });
      if (count > 0 || req.query.includeZero === "true") {
        result.push({
          type,
          count,
        });
      }
    }
    result.sort((a, b) => b.count - a.count);

    success(res, result, "Visit type statistics retrieved successfully");
  } catch (err) {
    next(err);
  }
});

router.get("/visits-trend", authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const visitRepo = AppDataSource.getRepository(VisitRecord);
    const days = Number(req.query.days) || 7;
    const communityId = req.query.communityId as string | undefined;
    const gridAreaId = req.query.gridAreaId as string | undefined;
    const gridWorkerId = req.query.gridWorkerId as string | undefined;

    const result: any[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const date = dayjs().subtract(i, "day");
      const startOfDay = date.startOf("day").toDate();
      const endOfDay = date.endOf("day").toDate();

      let totalBuilder = visitRepo.createQueryBuilder("v")
        .where("v.visitTime >= :start", { start: startOfDay })
        .andWhere("v.visitTime <= :end", { end: endOfDay });
      if (communityId) totalBuilder = totalBuilder.andWhere("v.communityId = :cid", { cid: communityId });
      if (gridAreaId) totalBuilder = totalBuilder.andWhere("v.gridAreaId = :gid", { gid: gridAreaId });
      if (gridWorkerId) totalBuilder = totalBuilder.andWhere("v.workerId = :gwid", { gwid: gridWorkerId });
      const count = await totalBuilder.getCount();

      let issueBuilder = visitRepo.createQueryBuilder("v")
        .where("v.visitTime >= :start", { start: startOfDay })
        .andWhere("v.visitTime <= :end", { end: endOfDay })
        .andWhere("v.hasIssue = :hi", { hi: true });
      if (communityId) issueBuilder = issueBuilder.andWhere("v.communityId = :cid", { cid: communityId });
      if (gridAreaId) issueBuilder = issueBuilder.andWhere("v.gridAreaId = :gid", { gid: gridAreaId });
      if (gridWorkerId) issueBuilder = issueBuilder.andWhere("v.workerId = :gwid", { gwid: gridWorkerId });
      const issueCount = await issueBuilder.getCount();

      result.push({
        date: date.format("YYYY-MM-DD"),
        total: count,
        withIssue: issueCount,
      });
    }

    success(res, result, "Visit trend statistics retrieved successfully");
  } catch (err) {
    next(err);
  }
});

router.get("/communities-ranking", authMiddleware, requireRoles(ROLES.ADMIN, ROLES.STREET), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const eventRepo = AppDataSource.getRepository(Event);
    const communityRepo = AppDataSource.getRepository(Community);

    const communities = await communityRepo.find({ where: { isActive: true } });
    const result: any[] = [];

    for (const c of communities) {
      const totalEvents = await eventRepo.count({ where: { communityId: c.id } });
      const completedEvents = await eventRepo.count({
        where: [
          { communityId: c.id, status: EVENT_STATUS.COMPLETED },
          { communityId: c.id, status: EVENT_STATUS.CLOSED },
        ],
      });

      result.push({
        id: c.id,
        name: c.name,
        code: c.code,
        totalEvents,
        completedEvents,
        completionRate: totalEvents > 0 ? Math.round(completedEvents / totalEvents * 100) : 0,
      });
    }

    result.sort((a, b) => b.completionRate - a.completionRate || b.totalEvents - a.totalEvents);

    success(res, result, "Community ranking statistics retrieved successfully");
  } catch (err) {
    next(err);
  }
});

router.get("/residents-by-tag", authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const residentRepo = AppDataSource.getRepository(Resident);
    const communityId = req.query.communityId as string | undefined;
    const gridAreaId = req.query.gridAreaId as string | undefined;

    const where: any = {};
    if (communityId) where.communityId = communityId;
    if (gridAreaId) where.gridAreaId = gridAreaId;

    const residents = await residentRepo.find({ where });
    const tagCount: Record<string, number> = {};

    for (const r of residents as any) {
      if (r.tags && Array.isArray(r.tags)) {
        for (const tag of r.tags) {
          tagCount[tag] = (tagCount[tag] || 0) + 1;
        }
      }
    }

    const result = Object.entries(tagCount)
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count);

    success(res, result, "Resident tag statistics retrieved successfully");
  } catch (err) {
    next(err);
  }
});

export default router;

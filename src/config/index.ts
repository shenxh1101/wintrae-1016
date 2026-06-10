export const JWT_SECRET = process.env.JWT_SECRET || "grid-management-secret-key-2024";
export const JWT_EXPIRES_IN = "24h";
export const PORT = process.env.PORT || 3000;

export const ROLES = {
  ADMIN: "admin",
  STREET: "street",
  COMMUNITY: "community",
  GRID_WORKER: "grid_worker",
  UPPER_PLATFORM: "upper_platform",
} as const;

export type RoleType = (typeof ROLES)[keyof typeof ROLES];

export const EVENT_STATUS = {
  PENDING: "pending",
  ASSIGNED: "assigned",
  PROCESSING: "processing",
  FEEDBACK: "feedback",
  REVISITING: "revisiting",
  COMPLETED: "completed",
  CLOSED: "closed",
  OVERDUE: "overdue",
} as const;

export type EventStatusType = (typeof EVENT_STATUS)[keyof typeof EVENT_STATUS];

export const EVENT_TYPES = [
  "环境卫生",
  "城市管理",
  "治安维稳",
  "矛盾纠纷",
  "民生服务",
  "安全生产",
  "消防隐患",
  "违建管控",
  "噪音扰民",
  "其他",
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

export const VISIT_TYPES = [
  "日常走访",
  "重点人员走访",
  "矛盾排查",
  "政策宣传",
  "帮扶慰问",
  "信息采集",
] as const;

export type VisitType = (typeof VISIT_TYPES)[number];

export const RESIDENT_TAGS = [
  "低保户",
  "残疾人",
  "空巢老人",
  "留守儿童",
  "重点关注",
  "退役军人",
  "党员家庭",
  "计生特殊家庭",
  "社区矫正",
  "刑满释放",
  "吸毒人员",
  "精神障碍患者",
  "信访重点",
  "流动人员",
] as const;

export type ResidentTag = (typeof RESIDENT_TAGS)[number];

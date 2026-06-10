export class ExportTask {
  id!: string;
  userId!: string;
  user?: any;
  taskName!: string;
  taskType!: string;
  status!: string;
  filters!: Record<string, any>;
  recordCount?: number;
  fileName?: string;
  filePath?: string;
  fileSize?: number;
  errorMessage?: string;
  startedAt?: Date;
  completedAt?: Date;
  createdAt!: Date;
}

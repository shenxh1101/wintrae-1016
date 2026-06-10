export class Attachment {
  id!: string;
  originalName!: string;
  fileName!: string;
  filePath!: string;
  fileSize!: number;
  mimeType!: string;
  bizType!: string;
  bizId!: string;
  uploaderId?: string;
  uploader?: any;
  createdAt!: Date;
}

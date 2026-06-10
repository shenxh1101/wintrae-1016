export class Notification {
  id!: string;
  userId!: string;
  user?: any;
  type!: string;
  title!: string;
  content!: string;
  eventId?: string;
  event?: any;
  relatedId?: string;
  isRead!: boolean;
  readAt?: Date;
  createdAt!: Date;
}

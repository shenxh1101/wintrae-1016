export class EventFlow {
  id!: string;
  eventId!: string;
  event?: any;
  action!: string;
  fromStatus?: string;
  toStatus?: string;
  operatorId?: string;
  operator?: any;
  operatorName?: string;
  remark?: string;
  createdAt!: Date;
}

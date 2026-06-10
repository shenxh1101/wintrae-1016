export class VisitRecord {
  id!: string;
  visitType!: string;
  residentId?: string;
  resident?: any;
  visitorId?: string;
  visitor?: any;
  visitorName!: string;
  communityId?: string;
  community?: any;
  gridAreaId?: string;
  gridArea?: any;
  visitTime!: Date;
  longitude?: number;
  latitude?: number;
  content!: string;
  situation?: string;
  problem?: string;
  solution?: string;
  remark?: string;
  hasIssue!: boolean;
  relatedEventId?: string;
  createdAt!: Date;
  updatedAt!: Date;
}

export class GridArea {
  id!: string;
  name!: string;
  code!: string;
  communityId?: string;
  community?: any;
  boundary?: string;
  areaSize?: number;
  householdCount?: number;
  populationCount?: number;
  gridWorkerId?: string;
  description?: string;
  isActive!: boolean;
  createdAt!: Date;
  updatedAt!: Date;
}

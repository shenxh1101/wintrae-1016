export class Community {
  id!: string;
  name!: string;
  code!: string;
  streetName?: string;
  address?: string;
  description?: string;
  longitude?: number;
  latitude?: number;
  isActive!: boolean;
  gridAreas?: any[];
  createdAt!: Date;
  updatedAt!: Date;
}

export class User {
  id!: string;
  username!: string;
  password!: string;
  realName!: string;
  role!: string;
  phone?: string;
  idCard?: string;
  avatar?: string;
  communityId?: string;
  community?: any;
  gridAreaId?: string;
  gridArea?: any;
  isActive!: boolean;
  createdAt!: Date;
  updatedAt!: Date;
}

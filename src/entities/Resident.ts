export class Resident {
  id!: string;
  name!: string;
  idCard?: string;
  gender?: "男" | "女";
  age?: number;
  phone?: string;
  communityId?: string;
  community?: any;
  gridAreaId?: string;
  gridArea?: any;
  address?: string;
  buildingNo?: string;
  roomNo?: string;
  tags?: string[];
  isKeyPerson!: boolean;
  keyPersonReason?: string;
  remark?: string;
  createdAt!: Date;
  updatedAt!: Date;
}

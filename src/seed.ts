const bcrypt = require("bcryptjs");
import { AppDataSource } from "./config/database";
import { User } from "./entities/User";
import { Community } from "./entities/Community";
import { GridArea } from "./entities/GridArea";
import { Resident } from "./entities/Resident";
import { ROLES } from "./config";

async function seed() {
  console.log("开始初始化数据...");

  await AppDataSource.initialize();
  console.log("数据库连接成功");

  const userRepo = AppDataSource.getRepository(User);
  const communityRepo = AppDataSource.getRepository(Community);
  const gridAreaRepo = AppDataSource.getRepository(GridArea);
  const residentRepo = AppDataSource.getRepository(Resident);

  const hashedPwd = await bcrypt.hash("123456", 10);

  const existingAdmin = await userRepo.findOne({ where: { username: "admin" } });
  if (!existingAdmin) {
    const admin = userRepo.create({
      username: "admin",
      password: hashedPwd,
      realName: "系统管理员",
      role: ROLES.ADMIN,
      phone: "13800000001",
      isActive: true,
    });
    await userRepo.save(admin);
    console.log("创建管理员: admin / 123456");
  }

  const existingStreet = await userRepo.findOne({ where: { username: "street01" } });
  if (!existingStreet) {
    const street = userRepo.create({
      username: "street01",
      password: hashedPwd,
      realName: "街道管理员",
      role: ROLES.STREET,
      phone: "13800000002",
      isActive: true,
    });
    await userRepo.save(street);
    console.log("创建街道管理员: street01 / 123456");
  }

  const existingUpper = await userRepo.findOne({ where: { username: "upper01" } });
  if (!existingUpper) {
    const upper = userRepo.create({
      username: "upper01",
      password: hashedPwd,
      realName: "上级平台对接用户",
      role: ROLES.UPPER_PLATFORM,
      phone: "13800000009",
      isActive: true,
    });
    await userRepo.save(upper);
    console.log("创建上级平台用户: upper01 / 123456");
  }

  const communityNames = [
    { name: "东风社区", code: "SQ001" },
    { name: "朝阳社区", code: "SQ002" },
    { name: "新华社区", code: "SQ003" },
    { name: "和平社区", code: "SQ004" },
    { name: "幸福社区", code: "SQ005" },
  ];

  const communities: Community[] = [];
  for (const c of communityNames) {
    let community = await communityRepo.findOne({ where: { code: c.code } });
    if (!community) {
      community = communityRepo.create({
        name: c.name,
        code: c.code,
        streetName: "示例街道办事处",
        address: `${c.name}居委会`,
        isActive: true,
      });
      await communityRepo.save(community);
      console.log(`创建社区: ${c.name}`);
    }
    communities.push(community!);
  }

  const existingCommunityUser = await userRepo.findOne({ where: { username: "community01" } });
  if (!existingCommunityUser) {
    const communityUser = userRepo.create({
      username: "community01",
      password: hashedPwd,
      realName: "东风社区管理员",
      role: ROLES.COMMUNITY,
      phone: "13800000003",
      communityId: communities[0].id,
      isActive: true,
    });
    await userRepo.save(communityUser);
    console.log("创建社区管理员: community01 / 123456");
  }

  for (let i = 0; i < communities.length; i++) {
    for (let j = 1; j <= 4; j++) {
      const code = `${communities[i].code}-W0${j}`;
      let grid = await gridAreaRepo.findOne({ where: { code } });
      if (!grid) {
        grid = gridAreaRepo.create({
          name: `${communities[i].name}第${j}网格`,
          code,
          communityId: communities[i].id,
          householdCount: 200 + Math.floor(Math.random() * 300),
          populationCount: 500 + Math.floor(Math.random() * 800),
          isActive: true,
        });
        await gridAreaRepo.save(grid);
        console.log(`创建网格: ${grid.name} (${code})`);
      }
    }
  }

  const firstGrid = await gridAreaRepo.findOne({ where: { code: "SQ001-W01" } });
  const secondGrid = await gridAreaRepo.findOne({ where: { code: "SQ001-W02" } });

  if (firstGrid) {
    const existingWorker = await userRepo.findOne({ where: { username: "worker01" } });
    if (!existingWorker) {
      const worker = userRepo.create({
        username: "worker01",
        password: hashedPwd,
        realName: "张网格员",
        role: ROLES.GRID_WORKER,
        phone: "13900000001",
        communityId: communities[0].id,
        gridAreaId: firstGrid.id,
        isActive: true,
      });
      await userRepo.save(worker);
      firstGrid.gridWorkerId = worker.id;
      await gridAreaRepo.save(firstGrid);
      console.log("创建网格员: worker01 / 123456");
    }
  }

  if (secondGrid) {
    const existingWorker = await userRepo.findOne({ where: { username: "worker02" } });
    if (!existingWorker) {
      const worker = userRepo.create({
        username: "worker02",
        password: hashedPwd,
        realName: "李网格员",
        role: ROLES.GRID_WORKER,
        phone: "13900000002",
        communityId: communities[0].id,
        gridAreaId: secondGrid.id,
        isActive: true,
      });
      await userRepo.save(worker);
      secondGrid.gridWorkerId = worker.id;
      await gridAreaRepo.save(secondGrid);
      console.log("创建网格员: worker02 / 123456");
    }
  }

  const sampleResidents = [
    { name: "王建国", idCard: "110101197001011234", phone: "13600000001", tags: ["党员家庭"], gender: "男", age: 55 },
    { name: "李秀英", idCard: "110101195001011234", phone: "13600000002", tags: ["空巢老人"], gender: "女", age: 75 },
    { name: "张小华", idCard: "110101198501011234", phone: "13600000003", tags: ["低保户"], gender: "男", age: 40 },
    { name: "赵大宝", idCard: "110101197501011234", phone: "13600000004", tags: ["重点关注", "社区矫正"], gender: "男", age: 50, isKey: true },
    { name: "陈美丽", idCard: "110101199001011234", phone: "13600000005", tags: ["退役军人"], gender: "女", age: 35 },
    { name: "刘大爷", idCard: "110101194501011234", phone: "13600000006", tags: ["空巢老人", "重点关注"], gender: "男", age: 80, isKey: true },
    { name: "孙小明", idCard: "110101201001011234", phone: "", tags: ["留守儿童"], gender: "男", age: 15 },
    { name: "周残疾人", idCard: "110101197801011234", phone: "13600000008", tags: ["残疾人", "低保户"], gender: "男", age: 47 },
  ];

  const existingResident = await residentRepo.count();
  if (existingResident === 0 && firstGrid) {
    for (const r of sampleResidents) {
      const resident = residentRepo.create({
        name: r.name,
        idCard: r.idCard,
        phone: r.phone,
        tags: r.tags as any,
        gender: r.gender as any,
        age: r.age,
        communityId: communities[0].id,
        gridAreaId: firstGrid.id,
        address: `${communities[0].name}1号楼1单元${100 + Math.floor(Math.random() * 200)}室`,
        buildingNo: `${Math.ceil(Math.random() * 20)}号楼`,
        roomNo: `${Math.ceil(Math.random() * 6)}-${Math.ceil(Math.random() * 30)}`,
        isKeyPerson: !!r.isKey,
        keyPersonReason: r.isKey ? "重点关注人员" : undefined,
      });
      await residentRepo.save(resident);
    }
    console.log(`创建 ${sampleResidents.length} 条示例居民数据`);
  }

  console.log("\n=== 初始化完成 ===");
  console.log("默认账号（密码均为 123456）:");
  console.log("  管理员:       admin");
  console.log("  街道管理员:   street01");
  console.log("  社区管理员:   community01");
  console.log("  网格员1:      worker01");
  console.log("  网格员2:      worker02");
  console.log("  上级平台用户: upper01");

  await AppDataSource.destroy();
}

seed().catch((err) => {
  console.error("初始化失败:", err);
  process.exit(1);
});

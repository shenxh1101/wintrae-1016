import * as path from "path";
import * as fs from "fs";
import { DataSource } from "../db/JsonDataSource";

const dbDir = path.resolve(__dirname, "../../data");
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

export const AppDataSource = new DataSource({
  type: "json",
  database: path.resolve(dbDir, "grid_management.json"),
  synchronize: true,
  logging: false,
  entities: [path.join(__dirname, "../entities/**/*.{ts,js}")],
  subscribers: [],
  migrations: [],
});

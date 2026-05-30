import postgres from "postgres";
import { getRequiredServerEnv } from "./env";

let sqlClient: postgres.Sql | null = null;

export function getSql() {
  if (!sqlClient) {
    sqlClient = postgres(getRequiredServerEnv("DATABASE_URL"), {
      max: 3,
      idle_timeout: 20,
      connect_timeout: 10,
      prepare: false,
    });
  }
  return sqlClient;
}

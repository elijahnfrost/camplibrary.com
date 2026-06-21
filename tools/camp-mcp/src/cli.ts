// Camp Library CLI — the same core as the MCP server, for scripting / one-offs.
//
//   tsx src/cli.ts whoami
//   tsx src/cli.ts context
//   tsx src/cli.ts events --from 2026-07-06 --to 2026-07-10
//   tsx src/cli.ts event --json '{"date":"2026-07-06","startMin":540,"endMin":585,"title":"Morning circle"}'
//   tsx src/cli.ts day --file day.json
//   tsx src/cli.ts delete <uuid>
//   tsx src/cli.ts diagram --file diagram.json
//   tsx src/cli.ts runlist --file runlist.json
//   tsx src/cli.ts doc --key themes --json '[…]'
//   tsx src/cli.ts camp --name "Summer Day Camp 2026"
//   tsx src/cli.ts theme --label "Ocean Week"
//
// Needs DATABASE_URL + CAMP_ADMIN_CLERK_USER_ID (env or repo-root .env.local).

import "./quiet";
import { readFileSync } from "node:fs";
import { loadEnv } from "./config";
import * as store from "./store";

loadEnv();

const argv = process.argv.slice(2);
const command = argv[0];

function flag(name: string): string | undefined {
  const i = argv.indexOf("--" + name);
  return i >= 0 ? argv[i + 1] : undefined;
}

function jsonArg(): unknown {
  const inline = flag("json");
  if (inline != null) return JSON.parse(inline);
  const file = flag("file");
  if (file != null) return JSON.parse(readFileSync(file, "utf8"));
  throw new Error("Provide --json '<value>' or --file <path>.");
}

function print(data: unknown): void {
  // Write results straight to stdout (console.log is redirected to stderr by
  // ./quiet to keep driver NOTICE chatter off the real output stream).
  process.stdout.write(JSON.stringify(data, null, 2) + "\n");
}

async function run(): Promise<void> {
  switch (command) {
    case "whoami":
      return print(await store.whoami());
    case "context":
      return print(await store.listContext());
    case "events":
      return print(await store.listEvents({ from: flag("from"), to: flag("to") }));
    case "event":
      return print(await store.upsertEvent(jsonArg() as store.EventInput));
    case "day":
      return print(await store.createDaySchedule(jsonArg() as Parameters<typeof store.createDaySchedule>[0]));
    case "delete": {
      const id = argv[1];
      if (!id) throw new Error("Usage: delete <uuid>");
      await store.deleteEvent(id);
      return print({ ok: true, id });
    }
    case "diagram":
      return print(await store.setDiagram(jsonArg() as store.DiagramInput));
    case "runlist":
      return print(await store.setRunList(jsonArg() as { activityId: string; blocks: unknown[] }));
    case "doc": {
      const key = flag("key");
      if (!key) throw new Error("Usage: doc --key <docKey> --json '<value>'");
      await store.setUserDoc(key as never, jsonArg() as never);
      return print({ ok: true, key });
    }
    case "camp": {
      const name = flag("name");
      if (!name) throw new Error("Usage: camp --name <name>");
      return print(await store.addCamp(name));
    }
    case "theme": {
      const label = flag("label");
      if (!label) throw new Error("Usage: theme --label <label>");
      return print(await store.addTheme(label));
    }
    default:
      console.error(
        "Commands: whoami | context | events | event | day | delete | diagram | runlist | doc | camp | theme",
      );
      process.exit(2);
  }
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Error:", err instanceof Error ? err.message : err);
    process.exit(1);
  });

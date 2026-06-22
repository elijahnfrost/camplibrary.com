// Camp Library CLI — the same core as the MCP server, for scripting / one-offs.
//
//   tsx src/cli.ts whoami
//   tsx src/cli.ts context
//   tsx src/cli.ts search --json '{"query":"octopus tag","type":"Game"}'
//   tsx src/cli.ts events --from 2026-07-06 --to 2026-07-10
//   tsx src/cli.ts event --json '{"date":"2026-07-06","startMin":540,"endMin":585,"title":"Morning circle"}'
//   tsx src/cli.ts recolor --json '{"activityId":"gaga-ball","color":"#3f6b45"}'
//   tsx src/cli.ts duplicate --json '{"id":"<uuid>","date":"2026-07-07"}'
//   tsx src/cli.ts day --file day.json
//   tsx src/cli.ts series --json '{"date":"2026-07-06","startMin":540,"endMin":585,"title":"Flag","recurrence":{"freq":"weekly","weekdays":[1,3,5],"until":"2026-07-31"}}'
//   tsx src/cli.ts editseries --json '{"id":"<uuid>","scope":"all","startMin":600}'
//   tsx src/cli.ts deleteseries --json '{"id":"<uuid>","scope":"following"}'
//   tsx src/cli.ts delete <uuid>
//   tsx src/cli.ts deletemany --json '["<uuid>","<uuid>"]'
//   tsx src/cli.ts activity --file activity.json   (custom library activity; CAN set a stable id)
//   tsx src/cli.ts activitycolor --json '{"activityId":"gaga-ball","color":"#3f6b45"}'   (null clears)
//   tsx src/cli.ts diagram --file diagram.json
//   tsx src/cli.ts runlist --file runlist.json
//   tsx src/cli.ts doc --key themes --json '[…]'
//   tsx src/cli.ts camp --name "Summer Day Camp 2026"
//   tsx src/cli.ts editcamp --json '{"id":"camp-…","openMin":450,"closeMin":1080}'
//   tsx src/cli.ts deletecamp camp-…
//   tsx src/cli.ts theme --label "Ocean Week"
//   tsx src/cli.ts edittheme --json '{"id":"theme-…","label":"Ocean Week"}'
//   tsx src/cli.ts deletetheme theme-…
//   tsx src/cli.ts unassigntheme gaga-ball
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
    case "search":
      return print(await store.searchActivities(jsonArg() as store.ActivitySearchInput));
    case "events":
      return print(await store.listEvents({ from: flag("from"), to: flag("to") }));
    case "event":
      return print(await store.upsertEvent(jsonArg() as store.EventInput));
    case "recolor":
      return print(await store.recolorEvents(jsonArg() as Parameters<typeof store.recolorEvents>[0]));
    case "duplicate":
      return print(await store.duplicateEvent(jsonArg() as Parameters<typeof store.duplicateEvent>[0]));
    case "day":
      return print(await store.createDaySchedule(jsonArg() as Parameters<typeof store.createDaySchedule>[0]));
    case "series":
      return print(await store.createSeries(jsonArg() as store.CreateSeriesInput));
    case "editseries":
      return print(await store.editSeries(jsonArg() as store.EditSeriesInput));
    case "deleteseries":
      return print(await store.deleteSeries(jsonArg() as { id: string; scope: "this" | "following" | "all" }));
    case "delete": {
      const id = argv[1];
      if (!id) throw new Error("Usage: delete <uuid>");
      await store.deleteEvent(id);
      return print({ ok: true, id });
    }
    case "deletemany":
      return print(await store.deleteEvents(jsonArg() as string[]));
    case "activity":
      // Add a custom library activity. Unlike the MCP add_custom_activity tool,
      // the CLI passes the raw JSON straight to the store, so it CAN set a stable
      // `id` (and energy / group sizes / age range) — handy for scripting a
      // schedule that references the activity by a known id right after creating it.
      return print(
        await store.addCustomActivity(jsonArg() as Parameters<typeof store.addCustomActivity>[0]),
      );
    case "activitycolor": {
      const input = jsonArg() as { activityId: string; color: string | null };
      return print(await store.setActivityColor(input.activityId, input.color ?? null));
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
    case "editcamp":
      return print(await store.editCamp(jsonArg() as Parameters<typeof store.editCamp>[0]));
    case "deletecamp": {
      const id = argv[1];
      if (!id) throw new Error("Usage: deletecamp <campId>");
      return print(await store.deleteCamp(id));
    }
    case "theme": {
      const label = flag("label");
      if (!label) throw new Error("Usage: theme --label <label>");
      return print(await store.addTheme(label));
    }
    case "edittheme": {
      const input = jsonArg() as { id: string; label: string };
      return print(await store.editTheme(input.id, input.label));
    }
    case "deletetheme": {
      const id = argv[1];
      if (!id) throw new Error("Usage: deletetheme <themeId>");
      return print(await store.deleteTheme(id));
    }
    case "unassigntheme": {
      const activityId = argv[1];
      if (!activityId) throw new Error("Usage: unassigntheme <activityId>");
      await store.unassignTheme(activityId);
      return print({ ok: true, activityId });
    }
    default:
      console.error(
        "Commands: whoami | context | search | events | event | recolor | duplicate | day | series | editseries | deleteseries | delete | deletemany | activity | activitycolor | diagram | runlist | doc | camp | editcamp | deletecamp | theme | edittheme | deletetheme | unassigntheme",
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

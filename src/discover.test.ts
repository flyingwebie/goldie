import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type Discovery,
  discover,
  type Plan,
  readDiscovery,
  readPlan,
  runDiscover,
  writePlan,
} from "./discover.ts";

async function tmpApp(): Promise<string> {
  return mkdtemp(join(tmpdir(), "goldie-discover-"));
}

describe("discover: Expo Router", () => {
  test("finds routes, strips groups, and skips _layout/+not-found/api routes", async () => {
    const root = await tmpApp();
    const appDir = join(root, "app");
    await mkdir(join(appDir, "(app)", "(tabs)"), { recursive: true });
    await mkdir(join(appDir, "missions"), { recursive: true });
    await mkdir(join(appDir, "api"), { recursive: true });
    await writeFile(
      join(appDir, "(app)", "(tabs)", "index.tsx"),
      "export default function DashboardScreen() { return null; }",
    );
    await writeFile(join(appDir, "(app)", "_layout.tsx"), "export default function Layout() {}");
    await writeFile(join(appDir, "+not-found.tsx"), "export default function NotFound() {}");
    await writeFile(join(appDir, "api", "+api.ts"), "export async function GET() {}");
    await writeFile(
      join(appDir, "missions", "[id].tsx"),
      "export default function MissionDetail() { return null; }",
    );

    const discovery = await discover({ appRoot: root });
    const routes = discovery.screens.filter((s) => s.source === "expo-router").map((s) => s.route);
    expect(routes).toContain("/");
    expect(routes).toContain("/missions/[id]");
    expect(routes).not.toContain(undefined);
    expect(discovery.screens.some((s) => s.title === "Not Found")).toBe(false);
    expect(discovery.screens.some((s) => s.file?.includes("+api"))).toBe(false);
    const dashboard = discovery.screens.find((s) => s.route === "/");
    expect(dashboard?.title).toBe("Dashboard");
  });

  test("detects a monorepo's apps/<name>/app directory", async () => {
    const root = await tmpApp();
    const appDir = join(root, "apps", "mobile", "app");
    await mkdir(appDir, { recursive: true });
    await writeFile(join(appDir, "settings.tsx"), "export default function SettingsScreen() {}");
    const discovery = await discover({ appRoot: root });
    expect(discovery.screens.some((s) => s.route === "/settings")).toBe(true);
  });
});

describe("discover: React Navigation", () => {
  test("finds Stack.Screen declarations outside _layout files", async () => {
    const root = await tmpApp();
    await writeFile(
      join(root, "AppNavigator.tsx"),
      `
      function AppNavigator() {
        return (
          <Stack.Navigator>
            <Stack.Screen name="Home" component={HomeScreen} options={{ title: "Welcome" }} />
          </Stack.Navigator>
        );
      }
      `,
    );
    const discovery = await discover({ appRoot: root });
    const screen = discovery.screens.find((s) => s.source === "react-navigation");
    expect(screen?.title).toBe("Welcome");
    expect(screen?.notes).toContain("HomeScreen");
  });

  test("ignores Stack.Screen inside _layout.tsx (Expo Router route config)", async () => {
    const root = await tmpApp();
    const appDir = join(root, "app");
    await mkdir(appDir, { recursive: true });
    await writeFile(
      join(appDir, "_layout.tsx"),
      `export default function Layout() {
        return <Stack><Stack.Screen name="index" /></Stack>;
      }`,
    );
    const discovery = await discover({ appRoot: root });
    expect(discovery.screens.some((s) => s.source === "react-navigation")).toBe(false);
  });
});

describe("discover: SwiftUI", () => {
  test("finds `struct XView: View`", async () => {
    const root = await tmpApp();
    await writeFile(
      join(root, "ProfileView.swift"),
      'struct ProfileView: View {\n  var body: some View { Text("hi") }\n}',
    );
    const discovery = await discover({ appRoot: root });
    const screen = discovery.screens.find((s) => s.source === "swiftui");
    expect(screen?.title).toBe("Profile");
  });
});

describe("discover: Jetpack Compose", () => {
  test("finds `@Composable fun XScreen(`", async () => {
    const root = await tmpApp();
    await writeFile(
      join(root, "Home.kt"),
      '@Composable\nfun HomeScreen(modifier: Modifier = Modifier) {\n  Text("hi")\n}',
    );
    const discovery = await discover({ appRoot: root });
    const screen = discovery.screens.find((s) => s.source === "compose");
    expect(screen?.title).toBe("Home");
  });
});

describe("discover: Flutter", () => {
  test("finds screen widgets and a routes: map entry", async () => {
    const root = await tmpApp();
    await writeFile(
      join(root, "main.dart"),
      `
      class SettingsScreen extends StatelessWidget {}
      final routes = {
        '/settings': (context) => const SettingsScreen(),
      };
      `,
    );
    const discovery = await discover({ appRoot: root });
    const screen = discovery.screens.find((s) => s.source === "flutter");
    expect(screen?.title).toBe("Settings");
    expect(screen?.route).toBe("/settings");
  });
});

describe("discover: argent flows", () => {
  test("lists flows with text hints", async () => {
    const root = await tmpApp();
    const flowsDir = join(root, ".argent", "flows");
    await mkdir(flowsDir, { recursive: true });
    await writeFile(
      join(flowsDir, "store-01-home.yaml"),
      "steps:\n  - tap: { text: Open menu }\n  - await: { visible: { text: Dashboard } }\n",
    );
    const discovery = await discover({ appRoot: root, flowsDir });
    const screen = discovery.screens.find((s) => s.source === "flow");
    expect(screen?.title).toBe("Store 01 Home");
    expect(screen?.notes).toContain("Open menu");
  });
});

describe("merge mode", () => {
  test("keeps agent-written thumbnail/featureIds/notes across a rescan", async () => {
    const root = await tmpApp();
    const appDir = join(root, "app");
    await mkdir(appDir, { recursive: true });
    await writeFile(join(appDir, "home.tsx"), "export default function HomeScreen() {}");

    const first = await discover({ appRoot: root });
    const screen = first.screens.find((s) => s.route === "/home")!;
    const withAgentData: Discovery = {
      ...first,
      screens: first.screens.map((s) =>
        s.id === screen.id
          ? {
              ...s,
              thumbnail: "discovery/home.png",
              featureIds: ["onboarding"],
              notes: "agent note",
            }
          : s,
      ),
      features: [
        { id: "onboarding", title: "Onboarding", description: "First run", screenIds: [screen.id] },
      ],
    };

    const second = await discover({ appRoot: root, existing: withAgentData });
    const merged = second.screens.find((s) => s.id === screen.id);
    expect(merged?.thumbnail).toBe("discovery/home.png");
    expect(merged?.featureIds).toEqual(["onboarding"]);
    expect(second.features).toHaveLength(1);
  });

  test("--fresh discards agent-written features and screen metadata", async () => {
    const root = await tmpApp();
    const appDir = join(root, "app");
    await mkdir(appDir, { recursive: true });
    await writeFile(join(appDir, "home.tsx"), "export default function HomeScreen() {}");

    const first = await discover({ appRoot: root });
    const screen = first.screens.find((s) => s.route === "/home")!;
    const withAgentData: Discovery = {
      ...first,
      screens: first.screens.map((s) =>
        s.id === screen.id ? { ...s, thumbnail: "discovery/home.png" } : s,
      ),
      features: [
        { id: "onboarding", title: "Onboarding", description: "First run", screenIds: [screen.id] },
      ],
    };

    const fresh = await discover({ appRoot: root, existing: withAgentData, fresh: true });
    expect(fresh.features).toHaveLength(0);
    expect(fresh.screens.find((s) => s.id === screen.id)?.thumbnail).toBeUndefined();
  });
});

describe("runDiscover", () => {
  test("writes discovery.json into the given goldie dir and merges on a second run", async () => {
    const root = await tmpApp();
    const appDir = join(root, "app");
    await mkdir(appDir, { recursive: true });
    await writeFile(join(appDir, "home.tsx"), "export default function HomeScreen() {}");

    const goldieDir = join(root, "goldie");
    const { file } = await runDiscover(goldieDir, { appRoot: root });
    expect(file).toBe(join(goldieDir, "discovery.json"));
    const loaded = await readDiscovery(goldieDir);
    expect(loaded?.screens.some((s) => s.route === "/home")).toBe(true);

    const again = await runDiscover(goldieDir, { appRoot: root });
    expect(again.discovery.screens.length).toBe(loaded!.screens.length);
  });
});

describe("plan.json", () => {
  test("round-trips through readPlan/writePlan", async () => {
    const root = await tmpApp();
    const plan: Plan = {
      updatedAt: new Date().toISOString(),
      decide: "user",
      features: ["onboarding"],
      screens: ["expo-home"],
      notes: "lead with onboarding",
    };
    expect(await readPlan(root)).toBeUndefined();
    await writePlan(root, plan);
    expect(await readPlan(root)).toEqual(plan);
  });
});

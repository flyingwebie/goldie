import {
  CheckIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  ListChecksIcon,
  Loader2Icon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { loadPlan, PlanError, type PlanResponse, savePlan, thumbnailUrl } from "../lib/plan";
import { EmptyState } from "./EmptyState";
import { Field } from "./Sidebar";

/**
 * Which features and screens the story should be built around (src/discover.ts,
 * src/plan via src/discover.ts's Plan type): the user's pick, in order, or
 * "let goldie decide". Reads `goldie/discovery.json` (written by `goldie
 * discover`) for the candidate list; writes `goldie/plan.json`.
 */
export function PlanView() {
  const [data, setData] = useState<PlanResponse | undefined>(undefined);
  const [error, setError] = useState<PlanError | null>(null);
  const [decide, setDecide] = useState<"user" | "goldie">("user");
  const [featureIds, setFeatureIds] = useState<string[]>([]);
  const [screenIds, setScreenIds] = useState<string[]>([]);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    loadPlan()
      .then((res) => {
        setData(res);
        setDecide(res.plan?.decide ?? "user");
        setFeatureIds(res.plan?.features ?? []);
        setScreenIds(res.plan?.screens ?? []);
        setNotes(res.plan?.notes ?? "");
      })
      .catch((e) => {
        if (e instanceof PlanError) setError(e);
        else throw e;
      });
  }, []);

  if (error) {
    return (
      <EmptyState
        icon={ListChecksIcon}
        title="No plan yet"
        body="Run goldie discover to find the app's screens and features, then come back."
        command={error.command}
      />
    );
  }
  if (data === undefined) return null;
  const { discovery } = data;

  const toggle = (list: string[], id: string, setList: (v: string[]) => void) =>
    setList(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  const move = (list: string[], id: string, dir: -1 | 1, setList: (v: string[]) => void) => {
    const i = list.indexOf(id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    const next = [...list];
    [next[i], next[j]] = [next[j]!, next[i]!];
    setList(next);
  };

  async function save() {
    setSaving(true);
    try {
      await savePlan({
        decide,
        features: featureIds,
        screens: screenIds,
        notes: notes || undefined,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } finally {
      setSaving(false);
    }
  }

  const disabledClass = decide === "goldie" ? "pointer-events-none opacity-50" : "";

  return (
    <div className="flex w-full max-w-3xl flex-col gap-5 text-foreground">
      <label className="flex items-center justify-between gap-3 rounded-xl border border-border p-3.5">
        <div>
          <div className="text-sm font-medium">Let goldie decide</div>
          <div className="text-[11px] text-muted-foreground">
            goldie chooses the strongest 4-5 screens around the brief itself, instead of the picks
            below.
          </div>
        </div>
        <input
          type="checkbox"
          checked={decide === "goldie"}
          onChange={(e) => setDecide(e.target.checked ? "goldie" : "user")}
          className="size-4 shrink-0"
        />
      </label>

      <section className={disabledClass}>
        <h2 className="mb-2 text-sm font-semibold">Features ({featureIds.length} selected)</h2>
        {discovery.features.length === 0 ? (
          <p className="text-[12px] text-muted-foreground">
            No features yet - ask your coding agent to write 4-8 candidate features from the brief
            into goldie/discovery.json.
          </p>
        ) : (
          <ol className="flex flex-col gap-1.5">
            {discovery.features.map((f) => {
              const index = featureIds.indexOf(f.id);
              return (
                <li
                  key={f.id}
                  className="flex items-center gap-2 rounded-lg border border-border px-3 py-2"
                >
                  <input
                    type="checkbox"
                    checked={index >= 0}
                    onChange={() => toggle(featureIds, f.id, setFeatureIds)}
                    className="size-4 shrink-0"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-medium">{f.title}</div>
                    <div className="truncate text-[11px] text-muted-foreground">
                      {f.description}
                    </div>
                  </div>
                  {index >= 0 ? (
                    <span className="text-[11px] text-muted-foreground">#{index + 1}</span>
                  ) : null}
                  <div className="flex flex-col">
                    <button
                      type="button"
                      aria-label="Move up"
                      onClick={() => move(featureIds, f.id, -1, setFeatureIds)}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <ChevronUpIcon className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      aria-label="Move down"
                      onClick={() => move(featureIds, f.id, 1, setFeatureIds)}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <ChevronDownIcon className="size-3.5" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      <section className={disabledClass}>
        <h2 className="mb-2 text-sm font-semibold">Screens ({screenIds.length} selected)</h2>
        {discovery.screens.length === 0 ? (
          <p className="text-[12px] text-muted-foreground">
            goldie found no screens in the app yet. Re-run goldie discover once the app has routes.
          </p>
        ) : (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {discovery.screens.map((s) => {
              const index = screenIds.indexOf(s.id);
              return (
                <label
                  key={s.id}
                  className="flex cursor-pointer flex-col gap-1 rounded-lg border border-border p-2"
                >
                  <div className="relative aspect-9/16 overflow-hidden rounded-md bg-muted">
                    {s.thumbnail ? (
                      <img
                        src={thumbnailUrl(s.thumbnail)}
                        alt={s.title}
                        className="h-full w-full object-cover"
                        draggable={false}
                      />
                    ) : (
                      <div className="grid h-full place-items-center p-1 text-center text-[10px] text-muted-foreground">
                        {s.route ?? s.file ?? s.title}
                      </div>
                    )}
                    {index >= 0 ? (
                      <span className="absolute top-1 left-1 grid size-5 place-items-center rounded-full bg-primary text-[10px] text-primary-foreground">
                        {index + 1}
                      </span>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={index >= 0}
                      onChange={() => toggle(screenIds, s.id, setScreenIds)}
                      className="size-3.5 shrink-0"
                    />
                    <span className="truncate text-[11px]">{s.title}</span>
                  </div>
                </label>
              );
            })}
          </div>
        )}
      </section>

      <Field label="Notes">
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          placeholder="Anything the agent should know when it builds this plan"
          className="w-full resize-none rounded-md border border-input bg-transparent p-2 text-sm shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        />
      </Field>

      <div className="flex items-center justify-between">
        <Button onClick={save} disabled={saving}>
          {saving ? <Loader2Icon className="animate-spin" /> : saved ? <CheckIcon /> : null}
          Save plan
        </Button>
        <p className="text-[11px] text-muted-foreground">
          Next: tell your agent &quot;build the plan&quot;.
        </p>
      </div>
    </div>
  );
}

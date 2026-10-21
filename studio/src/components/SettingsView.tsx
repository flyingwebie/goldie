import {
  CheckIcon,
  ExternalLinkIcon,
  Loader2Icon,
  RefreshCwIcon,
  TrashIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  type ArtModel,
  type KeyStatus,
  loadSettings,
  refreshOpenAiModels,
  removeKey,
  type Settings,
  saveKey,
} from "../lib/settings";
import { EmptyState } from "./EmptyState";
import { Field, Select } from "./Sidebar";

/**
 * API keys and AI model/style choices, editable here instead of a `.env`
 * file: keys go to a per-user credentials file on this machine
 * (src/credentials.ts), never into the repo. Model/draft-model/style ride
 * on goldie.design.json's `art` field, the same sidecar the rest of the
 * studio's choices live in (see saveArt below for the read-merge-write).
 */
export function SettingsView() {
  const [settings, setSettings] = useState<Settings | null | undefined>(undefined);
  const [keyInputs, setKeyInputs] = useState({ openai: "", fal: "" });
  const [keyBusy, setKeyBusy] = useState<"openai" | "fal" | null>(null);
  const [keyErrors, setKeyErrors] = useState<{ openai?: string; fal?: string }>({});
  const [art, setArt] = useState({
    provider: "openai" as "openai" | "fal",
    model: "",
    draftModel: "",
    style: "",
  });
  const [artBusy, setArtBusy] = useState(false);
  const [artSaved, setArtSaved] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = () =>
    loadSettings().then((s) => {
      setSettings(s);
      if (s?.art.configured) {
        setArt({
          provider: s.art.provider,
          model: s.art.model ?? "",
          draftModel: s.art.draftModel ?? "",
          style: s.art.style,
        });
      }
    });
  // biome-ignore lint/correctness/useExhaustiveDependencies: load once on mount; refresh is called again, explicitly, after a key/model change
  useEffect(() => {
    refresh();
  }, []);

  if (settings === undefined) return null;
  if (settings === null) {
    return (
      <EmptyState
        icon={TriangleAlertIcon}
        title="Settings unavailable"
        body="The studio's API is not reachable from here (a static build has none)."
      />
    );
  }

  async function saveProviderKey(provider: "openai" | "fal") {
    const key = keyInputs[provider].trim();
    if (!key) return;
    setKeyBusy(provider);
    setKeyErrors((e) => ({ ...e, [provider]: undefined }));
    const result = await saveKey(provider, key);
    setKeyBusy(null);
    if (!result.ok) {
      setKeyErrors((e) => ({ ...e, [provider]: result.error }));
      return;
    }
    setKeyInputs((v) => ({ ...v, [provider]: "" }));
    refresh();
  }

  async function removeProviderKey(provider: "openai" | "fal") {
    setKeyBusy(provider);
    await removeKey(provider);
    setKeyBusy(null);
    refresh();
  }

  async function saveArt() {
    setArtBusy(true);
    try {
      // Read-merge-write: goldie.design.json holds fields the Export/Design
      // panel and the element editor own too; only `art` changes here.
      const current = await fetch("/api/design", { cache: "no-store" })
        .then((r) => r.json())
        .catch(() => ({}));
      await fetch("/api/design", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...current,
          art: {
            provider: art.provider,
            model: art.model || undefined,
            draftModel: art.draftModel || undefined,
            style: art.style || undefined,
          },
        }),
      });
      setArtSaved(true);
      setTimeout(() => setArtSaved(false), 1500);
    } finally {
      setArtBusy(false);
    }
  }

  async function doRefreshModels() {
    setRefreshing(true);
    const result = await refreshOpenAiModels();
    setRefreshing(false);
    if (result.models) {
      const fresh = result.models;
      setSettings((s) =>
        s ? { ...s, models: [...fresh, ...s.models.filter((m) => m.provider === "fal")] } : s,
      );
    }
  }

  return (
    <div className="flex w-full max-w-2xl flex-col gap-6 text-foreground">
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">AI art keys</h2>
        <KeyCard
          label="OpenAI"
          helpUrl="https://platform.openai.com/api-keys"
          helpLabel="platform.openai.com/api-keys"
          status={settings.keys.openai}
          value={keyInputs.openai}
          onChange={(v) => setKeyInputs((s) => ({ ...s, openai: v }))}
          onSave={() => saveProviderKey("openai")}
          onRemove={() => removeProviderKey("openai")}
          busy={keyBusy === "openai"}
          error={keyErrors.openai}
        />
        <KeyCard
          label="fal.ai"
          helpUrl="https://fal.ai/dashboard/keys"
          helpLabel="fal.ai/dashboard/keys"
          status={settings.keys.fal}
          value={keyInputs.fal}
          onChange={(v) => setKeyInputs((s) => ({ ...s, fal: v }))}
          onSave={() => saveProviderKey("fal")}
          onRemove={() => removeProviderKey("fal")}
          busy={keyBusy === "fal"}
          error={keyErrors.fal}
        />
        <p className="text-[11px] text-muted-foreground">
          Keys are saved on this machine only, never into this repo, and are only ever sent to the
          provider you choose.
        </p>
      </section>

      <section className="flex flex-col gap-3 rounded-xl border border-border p-4">
        <h2 className="text-sm font-semibold">Model &amp; style</h2>
        {!settings.art.configured ? (
          <p className="text-[12px] text-muted-foreground">
            Add an <code className="font-mono">art</code> block to goldie.config.ts to turn on AI
            art; these settings apply to it once it exists.
          </p>
        ) : null}
        <fieldset
          disabled={!settings.art.configured}
          className="flex flex-col gap-3 disabled:pointer-events-none disabled:opacity-50"
        >
          <Field label="Provider">
            <Select
              value={art.provider}
              onChange={(v) => setArt((a) => ({ ...a, provider: v as "openai" | "fal" }))}
              options={[
                ["openai", "OpenAI"],
                ["fal", "fal.ai"],
              ]}
            />
          </Field>
          <Field label="Final model">
            <Select
              value={art.model}
              onChange={(v) => setArt((a) => ({ ...a, model: v }))}
              options={modelOptions(settings.models, art.provider, "final")}
            />
          </Field>
          <Field label="Draft model">
            <Select
              value={art.draftModel}
              onChange={(v) => setArt((a) => ({ ...a, draftModel: v }))}
              options={modelOptions(settings.models, art.provider, "draft")}
            />
          </Field>
          <Field label="Style">
            <Input
              value={art.style}
              onChange={(e) => setArt((a) => ({ ...a, style: e.target.value }))}
              placeholder="hand-drawn, or your own art direction"
            />
          </Field>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(settings.styles).map(([key, s]) => (
              <button
                key={key}
                type="button"
                onClick={() => setArt((a) => ({ ...a, style: key }))}
                title={s.description}
                className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                {s.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            {art.provider === "openai" ? (
              <Button variant="outline" size="sm" onClick={doRefreshModels} disabled={refreshing}>
                {refreshing ? <Loader2Icon className="animate-spin" /> : <RefreshCwIcon />}
                Refresh from OpenAI
              </Button>
            ) : null}
            <Button size="sm" onClick={saveArt} disabled={artBusy}>
              {artBusy ? <Loader2Icon className="animate-spin" /> : artSaved ? <CheckIcon /> : null}
              Save
            </Button>
          </div>
        </fieldset>
      </section>
    </div>
  );
}

/** Models for one provider, suited to the slot ("final" excludes draft-only, "draft" excludes final-only). */
function modelOptions(
  models: ArtModel[],
  provider: "openai" | "fal",
  slot: "final" | "draft",
): Array<[string, string]> {
  const filtered = models.filter(
    (m) => m.provider === provider && (slot === "final" ? m.role !== "draft" : m.role !== "final"),
  );
  return [
    ["", "(provider default)"],
    ...filtered.map(
      (m) => [m.id, `${m.label} · ~$${m.approxCostUsd.toFixed(2)}`] as [string, string],
    ),
  ];
}

function KeyCard({
  label,
  helpUrl,
  helpLabel,
  status,
  value,
  onChange,
  onSave,
  onRemove,
  busy,
  error,
}: {
  label: string;
  helpUrl: string;
  helpLabel: string;
  status: KeyStatus;
  value: string;
  onChange: (v: string) => void;
  onSave: () => void;
  onRemove: () => void;
  busy: boolean;
  error?: string;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border p-3.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium">{label}</span>
        <StatusChip status={status} />
      </div>
      <div className="flex gap-2">
        <Input
          type="password"
          placeholder={status.set ? "Replace key" : "Paste your key"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <Button size="sm" onClick={onSave} disabled={busy || !value.trim()}>
          {busy ? <Loader2Icon className="animate-spin" /> : "Save"}
        </Button>
        {status.set && status.source === "user" ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={onRemove}
            disabled={busy}
            aria-label="Remove key"
          >
            <TrashIcon />
          </Button>
        ) : null}
      </div>
      {error ? <p className="text-[11px] text-destructive">{error}</p> : null}
      <a
        href={helpUrl}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
      >
        Get a key at {helpLabel}
        <ExternalLinkIcon className="size-3" aria-hidden />
      </a>
    </div>
  );
}

function StatusChip({ status }: { status: KeyStatus }) {
  if (!status.set) {
    return <span className="text-[11px] text-muted-foreground">Not set</span>;
  }
  const label =
    status.source === "env"
      ? "From environment"
      : status.source === "project"
        ? "From goldie/.env"
        : status.source === "app"
          ? "From the app's .env"
          : `Saved in your user settings · ••••${status.last4 ?? ""}`;
  return (
    <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
      {label}
    </span>
  );
}

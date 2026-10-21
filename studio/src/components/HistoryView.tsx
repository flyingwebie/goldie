import { ClockIcon, EyeIcon, HistoryIcon, RotateCcwIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { type HistoryEntry, loadHistory, timeAgo } from "../lib/designHistory";
import { EmptyState } from "./EmptyState";

/**
 * Persistent version history for goldie.design.json (src/history.ts):
 * every save is a row here, oldest mistakes included. "Preview" loads a
 * row into the strip without saving (the App-level banner carries
 * Restore/Cancel while it is active); "Restore" here applies it directly,
 * both as one undo step the in-session undo stack can still back out of.
 */
export function HistoryView({
  previewingId,
  onPreview,
  onRestore,
}: {
  previewingId: string | null;
  onPreview: (entry: HistoryEntry) => void;
  onRestore: (id: string) => void;
}) {
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = () => loadHistory().then(setEntries);
  // biome-ignore lint/correctness/useExhaustiveDependencies: load once on mount; refresh is called again, explicitly, after a restore
  useEffect(() => {
    refresh();
  }, []);

  if (entries === null) return null;

  if (entries.length === 0) {
    return (
      <EmptyState
        icon={HistoryIcon}
        title="No history yet"
        body="Every design change you save here is snapshotted automatically. Make a change and come back."
      />
    );
  }

  const restore = async (id: string) => {
    setBusyId(id);
    try {
      onRestore(id);
    } finally {
      setBusyId(null);
      refresh();
    }
  };

  return (
    <div className="flex w-full max-w-xl flex-col gap-3">
      <p className="text-center text-sm text-muted-foreground">
        Every saved change, newest first. Preview a version in the strip before you commit to it.
      </p>
      <ol className="flex flex-col gap-2">
        {entries.map((entry) => (
          <li
            key={entry.id}
            className={`flex items-center gap-3 rounded-xl border px-3.5 py-2.5 transition-colors ${
              previewingId === entry.id ? "border-ring bg-muted/60" : "border-border bg-background"
            }`}
          >
            <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
              <ClockIcon className="size-4" aria-hidden />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-medium text-foreground">{timeAgo(entry.timestamp)}</div>
              <div className="truncate text-[11px] text-muted-foreground">{entry.summary}</div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onPreview(entry)}
              aria-pressed={previewingId === entry.id}
            >
              <EyeIcon />
              Preview
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={busyId === entry.id}
              onClick={() => restore(entry.id)}
            >
              <RotateCcwIcon />
              Restore
            </Button>
          </li>
        ))}
      </ol>
    </div>
  );
}

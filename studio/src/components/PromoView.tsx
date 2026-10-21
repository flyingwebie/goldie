import { useState } from "react";
import type { StoreManifest } from "../manifest";
import { Field, Select } from "./Sidebar";

/**
 * The social promo video (`goldie promo`): plays the rendered clip for the
 * current locale, with a format picker when more than one aspect ratio was
 * rendered. Read-only - the promo is produced by the CLI, not composited
 * live like the strip.
 */
export function PromoView({
  promo,
  locale,
}: {
  promo: NonNullable<StoreManifest["promo"]>;
  locale: string;
}) {
  const forLocale = promo.filter((p) => p.locale === locale);
  const list = forLocale.length > 0 ? forLocale : promo;
  const formats = [...new Set(list.map((p) => p.format))];
  const [format, setFormat] = useState(formats[0] ?? "");
  const entry = list.find((p) => p.format === format) ?? list[0];

  if (!entry) return null;

  return (
    <div className="flex w-full max-w-sm flex-col items-center gap-4">
      <div
        className="tile-shadow overflow-hidden rounded-2xl bg-black ring-1 ring-black/10 dark:ring-white/10"
        style={{ aspectRatio: entry.format.replace(":", " / ") }}
      >
        {/* biome-ignore lint/a11y/useMediaCaption: goldie renders no caption track for the promo video */}
        <video
          key={entry.url}
          src={`/${entry.url}`}
          controls
          loop
          playsInline
          className="h-full w-full object-contain"
        />
      </div>
      <div className="flex w-full items-center justify-between gap-3 text-[11px] text-muted-foreground">
        <span>
          {entry.format} · {entry.durationSeconds.toFixed(1)}s
        </span>
        {formats.length > 1 ? (
          <div className="w-28">
            <Field label="">
              <Select
                value={format}
                onChange={setFormat}
                options={formats.map((f) => [f, f])}
                size="sm"
              />
            </Field>
          </div>
        ) : null}
      </div>
    </div>
  );
}

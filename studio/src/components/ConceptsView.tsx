import type { StoreManifest } from "../manifest";

/**
 * Art-direction concept boards (`goldie concepts`): a grid of candidate
 * styles for the agent and the user to pick from together. Picking happens
 * in conversation, not here - the caption says so.
 */
export function ConceptsView({ concepts }: { concepts: NonNullable<StoreManifest["concepts"]> }) {
  return (
    <div className="flex w-full max-w-5xl flex-col gap-4">
      <p className="text-center text-sm text-muted-foreground">
        Pick a style, then tell your coding agent which one you want.
      </p>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        {concepts.map((c) => (
          <figure key={c.style} className="flex flex-col gap-2">
            <div className="tile-shadow overflow-hidden rounded-2xl bg-neutral-200 ring-1 ring-black/10 dark:bg-neutral-800 dark:ring-white/10">
              <img src={`/${c.url}`} alt={c.label} className="block w-full" draggable={false} />
            </div>
            <figcaption className="text-center text-xs font-medium text-muted-foreground capitalize">
              {c.label}
            </figcaption>
          </figure>
        ))}
      </div>
    </div>
  );
}

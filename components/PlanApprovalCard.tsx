"use client";

type Props = {
  steps: string[];
  onApprove: () => void;
  onCancel: () => void;
  busy?: boolean;
};

export default function PlanApprovalCard({ steps, onApprove, onCancel, busy }: Props) {
  return (
    <div className="animate-fade-in-up rounded-card border border-clay/25 bg-clay/5 px-4 py-3">
      <p className="text-sm font-medium text-ink">Here's my plan:</p>
      <ol className="mt-2 list-decimal space-y-1 pl-4 text-sm text-ink/75">
        {steps.map((s, i) => (
          <li key={i}>{s}</li>
        ))}
      </ol>
      <div className="mt-3 flex gap-2">
        <button
          onClick={onApprove}
          disabled={busy}
          className="focus-ring rounded-md bg-clay px-3 py-1.5 text-xs font-medium text-cream transition-all hover:scale-[1.02] hover:bg-clay-dark disabled:opacity-50"
        >
          {busy ? "Working..." : "Approve & run"}
        </button>
        <button
          onClick={onCancel}
          disabled={busy}
          className="focus-ring rounded-md border border-ink/15 px-3 py-1.5 text-xs text-ink/60 transition-colors hover:bg-sand disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
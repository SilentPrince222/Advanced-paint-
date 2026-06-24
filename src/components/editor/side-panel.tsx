"use client";

import { useState } from "react";
import { useFlowStore } from "@/lib/flow-store";
import { getVariant } from "@/lib/block-registry";
import { paramSummary } from "@/lib/node-summary";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { BlockFieldSchema } from "@/lib/types";

function NumberField({
  field,
  value,
  onChange,
}: {
  field: BlockFieldSchema;
  value: unknown;
  onChange: (v: string | number) => void;
}) {
  const [raw, setRaw] = useState<string | null>(null);
  const displayed = raw ?? (value === undefined || value === null ? "" : String(value));

  return (
    <Input
      id={`field-${field.key}`}
      type="text"
      inputMode="decimal"
      data-testid={`field-${field.key}`}
      value={displayed}
      placeholder={field.placeholder}
      onChange={(e) => {
        const v = e.target.value;
        setRaw(v);
        const n = Number(v);
        if (v !== "" && !Number.isNaN(n) && Number.isFinite(n)) {
          onChange(n);
        } else {
          onChange(v);
        }
      }}
      onBlur={() => setRaw(null)}
    />
  );
}

const CREDENTIAL_OPTIONS = [
  { id: "demo/stripe-test", label: "Stripe test key" },
];

export function SidePanel() {
  const nodes = useFlowStore((state) => state.nodes);
  const updateNodeData = useFlowStore((state) => state.updateNodeData);

  const selected = nodes.filter((n) => n.selected);

  if (selected.length !== 1) {
    return (
      <aside
        data-testid="side-panel"
        className="flex h-full w-72 shrink-0 flex-col border-l border-sidebar-border bg-sidebar text-sidebar-foreground"
      >
        <div className="flex flex-1 items-center justify-center px-4">
          <p className="text-sm text-muted-foreground">Select a block</p>
        </div>
      </aside>
    );
  }

  const node = selected[0]!;
  const variant = getVariant(node.data.type);

  if (!variant) {
    return (
      <aside
        data-testid="side-panel"
        className="flex h-full w-72 shrink-0 flex-col border-l border-sidebar-border bg-sidebar text-sidebar-foreground"
      >
        <div className="flex flex-1 items-center justify-center px-4">
          <p className="text-sm text-muted-foreground">Select a block</p>
        </div>
      </aside>
    );
  }

  const summary = paramSummary(variant, node.data.params);

  const setParam = (field: BlockFieldSchema, raw: string | number | boolean) => {
    updateNodeData(node.id, {
      params: { ...node.data.params, [field.key]: raw },
    });
  };

  return (
    <aside
      data-testid="side-panel"
      className="flex h-full w-72 shrink-0 flex-col border-l border-sidebar-border bg-sidebar text-sidebar-foreground"
    >
      <div className="border-b border-sidebar-border px-4 py-4">
        <h2 className="text-sm font-semibold tracking-tight">{variant.label}</h2>
        {summary ? (
          <p className="mt-1 text-xs text-muted-foreground">{summary}</p>
        ) : null}
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {variant.fields.map((field) => (
          <div key={field.key} className="space-y-1.5">
            <Label htmlFor={`field-${field.key}`}>{field.label}</Label>
            {field.type === "text" && (
              <Input
                id={`field-${field.key}`}
                data-testid={`field-${field.key}`}
                value={String(node.data.params[field.key] ?? "")}
                placeholder={field.placeholder}
                onChange={(e) => setParam(field, e.target.value)}
              />
            )}
            {field.type === "textarea" && (
              <textarea
                id={`field-${field.key}`}
                data-testid={`field-${field.key}`}
                value={String(node.data.params[field.key] ?? "")}
                placeholder={field.placeholder}
                onChange={(e) => setParam(field, e.target.value)}
                className={cn(
                  "min-h-20 w-full rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30",
                )}
              />
            )}
            {field.type === "number" && (
              <NumberField
                field={field}
                value={node.data.params[field.key]}
                onChange={(raw) => setParam(field, raw)}
              />
            )}
            {field.type === "select" && (
              <select
                id={`field-${field.key}`}
                data-testid={`field-${field.key}`}
                value={String(node.data.params[field.key] ?? "")}
                onChange={(e) => setParam(field, e.target.value)}
                className={cn(
                  "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30",
                )}
              >
                {(field.options ?? []).map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            )}
            {field.type === "toggle" && (
              <input
                id={`field-${field.key}`}
                type="checkbox"
                data-testid={`field-${field.key}`}
                checked={Boolean(node.data.params[field.key])}
                onChange={(e) => setParam(field, e.target.checked)}
                className="h-4 w-4 rounded border border-input"
              />
            )}
            {field.help ? (
              <p className="text-xs text-muted-foreground">{field.help}</p>
            ) : null}
          </div>
        ))}

        {variant.requiresCredential ? (
          <div className="space-y-1.5 border-t border-sidebar-border pt-4">
            <Label htmlFor="credential-select">Credential</Label>
            <select
              id="credential-select"
              data-testid="credential-select"
              value={node.data.credentialRef ?? ""}
              onChange={(e) =>
                updateNodeData(node.id, {
                  credentialRef: e.target.value || undefined,
                })
              }
              className={cn(
                "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30",
              )}
            >
              <option value="">Select credential…</option>
              {CREDENTIAL_OPTIONS.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        ) : null}
      </div>
    </aside>
  );
}

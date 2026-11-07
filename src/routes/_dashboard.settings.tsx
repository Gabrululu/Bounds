import { useState, type FormEvent } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { isAddress } from "viem";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/bounds/shared";
import { useSettings } from "@/components/bounds/use-services";
import { publicClient } from "@/services/chain";
import {
  SEPOLIA_RPC,
  WALLETCONNECT_PROJECT_ID,
  parseLabels,
  saveSettings,
} from "@/services/config";
import { getSupabase } from "@/services/supabase";

export const Route = createFileRoute("/_dashboard/settings")({
  head: () => ({
    meta: [
      { title: "Settings — Bounds" },
      { name: "description", content: "Contract addresses and fleet configuration for Bounds." },
    ],
  }),
  component: SettingsPage,
});

const LABEL = /^[a-z0-9-]+$/;
const ENS_PARENT = /^([a-z0-9-]+\.)+eth$/;

function validate(form: { guardian: string; parent: string; labels: string; deployBlock: string }) {
  const errors: Record<string, string> = {};
  if (form.guardian && !isAddress(form.guardian)) errors["guardian"] = "Not a valid address.";
  if (form.parent && !ENS_PARENT.test(form.parent))
    errors["parent"] = "Use a name such as acme.eth.";
  if (form.deployBlock && !/^\d+$/.test(form.deployBlock))
    errors["deployBlock"] = "Must be a block number.";
  const bad = parseLabels(form.labels).filter((l) => !LABEL.test(l));
  if (bad.length)
    errors["labels"] = `Invalid labels: ${bad.join(", ")}. Use the part before the parent name.`;
  return errors;
}

/** Catches the most common mistake: an address with no contract on Sepolia. */
async function warnIfNoContract(name: string, address: string) {
  if (!address) return;
  try {
    const code = await publicClient.getCode({ address: address as `0x${string}` });
    if (!code || code === "0x") toast.warning(`${name}: no contract at this address on Sepolia.`);
  } catch {
    toast.warning(`${name}: could not check this address. The Sepolia RPC did not respond.`);
  }
}

function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint: string;
  error?: string | undefined;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : (
        <p className="text-xs text-muted-foreground">{hint}</p>
      )}
    </div>
  );
}

function ConfigRow({ label, ok, detail }: { label: string; ok: boolean; detail: string }) {
  return (
    <li className="flex items-start gap-2 text-sm">
      {ok ? (
        <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
      ) : (
        <XCircle className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      )}
      <span>
        {label}
        <span className="block text-xs text-muted-foreground">{detail}</span>
      </span>
    </li>
  );
}

function SettingsPage() {
  const settings = useSettings();
  const [guardian, setGuardian] = useState(settings.guardianAddress);
  const [parent, setParent] = useState(settings.ensParent);
  const [labels, setLabels] = useState(settings.robotLabels.join("\n"));
  const [deployBlock, setDeployBlock] = useState(settings.deployBlock);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const form = {
      guardian: guardian.trim(),
      parent: parent.trim().toLowerCase(),
      labels,
      deployBlock: deployBlock.trim(),
    };
    const found = validate(form);
    setErrors(found);
    if (Object.keys(found).length) return;
    setSaving(true);
    saveSettings({
      guardianAddress: form.guardian,
      ensParent: form.parent,
      robotLabels: parseLabels(form.labels),
      deployBlock: form.deployBlock,
    });
    await warnIfNoContract("Guardian", form.guardian);
    setSaving(false);
    toast.success("Settings saved in this browser");
  };

  return (
    <>
      <PageHeader
        title="Settings"
        description="Contract addresses and fleet configuration. Saved in this browser and overriding the build's env defaults."
      />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <form
          onSubmit={onSubmit}
          className="space-y-5 rounded-2xl border border-border bg-card p-6"
        >
          <Field
            id="guardian"
            label="Guardian contract"
            hint="RobotRegistrar address on Sepolia. Default: VITE_GUARDIAN_ADDRESS."
            error={errors["guardian"]}
          >
            <Input
              id="guardian"
              value={guardian}
              onChange={(e) => setGuardian(e.target.value)}
              placeholder="0x…"
              className="font-mono"
              spellCheck={false}
            />
          </Field>
          <Field
            id="deployBlock"
            label="Guardian deploy block"
            hint="Chain events are scanned from here. If empty, only the last 30 days are scanned."
            error={errors["deployBlock"]}
          >
            <Input
              id="deployBlock"
              value={deployBlock}
              onChange={(e) => setDeployBlock(e.target.value)}
              inputMode="numeric"
              className="font-mono"
            />
          </Field>
          <Field
            id="parent"
            label="Parent ENS name"
            hint="Robots are subnames of this name on Sepolia."
            error={errors["parent"]}
          >
            <Input
              id="parent"
              value={parent}
              onChange={(e) => setParent(e.target.value)}
              placeholder="acme.eth"
              className="font-mono"
              spellCheck={false}
            />
          </Field>
          <Field
            id="labels"
            label="Extra robot labels"
            hint="Optional, one per line. Robots with a license onchain appear without being listed here."
            error={errors["labels"]}
          >
            <Textarea
              id="labels"
              rows={5}
              value={labels}
              onChange={(e) => setLabels(e.target.value)}
              className="font-mono"
              spellCheck={false}
            />
          </Field>
          <Button type="submit" disabled={saving}>
            {saving && <Loader2 className="animate-spin" />} Save settings
          </Button>
        </form>

        <aside className="h-fit rounded-2xl border border-border bg-card p-6">
          <p className="mb-3 text-sm font-medium">Build configuration</p>
          <ul className="space-y-3">
            <ConfigRow
              label="Supabase"
              ok={!!getSupabase()}
              detail="VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY"
            />
            <ConfigRow
              label="Sepolia RPC"
              ok={!!SEPOLIA_RPC}
              detail={SEPOLIA_RPC ? "VITE_SEPOLIA_RPC" : "Using viem's default public RPC"}
            />
            <ConfigRow
              label="WalletConnect"
              ok={!!WALLETCONNECT_PROJECT_ID}
              detail={WALLETCONNECT_PROJECT_ID ? "Mobile wallets enabled" : "Browser wallets only"}
            />
          </ul>
          <p className="mt-4 text-xs text-muted-foreground">
            These come from env vars at build time. Server secrets are never in this app.
          </p>
        </aside>
      </div>
    </>
  );
}

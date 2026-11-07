import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CheckCircle2, Loader2 } from "lucide-react";
import { isAddress } from "viem";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { grantLicense, listZones } from "@/services/robots";
import type { Permission } from "@/services/types";
import { clearTx } from "@/services/tx";
import { ZoneMap } from "./ZoneMap";
import { TxLink } from "./shared";
import { useSettings, useTx } from "./use-services";
import { WalletGate } from "./WalletControls";

const PERMS: { id: Permission; label: string; desc: string }[] = [
  { id: "move", label: "Move", desc: "Translate within the bounded zone" },
  { id: "manipulate", label: "Manipulate", desc: "Operate arm / gripper / tool" },
  { id: "enter-shared-area", label: "Enter shared area", desc: "Enter human-collaborative region" },
];

export function GrantLicenseDrawer({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const zones = useQuery({ queryKey: ["zones"], queryFn: listZones });
  const [ens, setEns] = useState("robot-08");
  const [robot, setRobot] = useState("");
  const [zoneId, setZoneId] = useState("cell-a");
  const [duration, setDuration] = useState<1 | 8 | 24>(8);
  const [perms, setPerms] = useState<Permission[]>(["move"]);
  const m = useMutation({ mutationFn: grantLicense });
  const tx = useTx("grant");
  const { ensParent } = useSettings();
  const zone = zones.data?.find((z) => z.id === zoneId);
  const labelValid = /^[a-z0-9-]+$/.test(ens);
  const robotValid = isAddress(robot.trim());
  const fullEns = ensParent ? `${ens}.${ensParent}` : ens;
  const txHash = m.data?.tx ?? tx?.hash;
  const pendingText =
    tx?.stage === "pending"
      ? "Waiting for Sepolia confirmation"
      : "Confirm the transaction in your wallet";

  const close = (o: boolean) => {
    onOpenChange(o);
    if (!o) {
      setTimeout(() => {
        m.reset();
        clearTx("grant");
      }, 300);
    }
  };

  return (
    <Sheet open={open} onOpenChange={close}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Grant license</SheetTitle>
          <SheetDescription>
            Authorize a robot to operate inside a bounded zone for a limited lease.
          </SheetDescription>
        </SheetHeader>

        {m.isPending || m.isSuccess ? (
          <div className="mt-10 flex flex-col items-center gap-4 px-4 text-center">
            {m.isPending ? (
              <Loader2 className="size-10 animate-spin text-primary-text" />
            ) : (
              <CheckCircle2 className="size-10 text-success" />
            )}
            <p className="font-medium">
              {m.isPending ? "Transaction pending…" : "License granted"}
            </p>
            <p className="text-sm text-muted-foreground">
              {m.isPending ? pendingText : `Confirmed on Sepolia. ${fullEns} is now authorized.`}
            </p>
            <div className="max-w-full break-all rounded-md border border-border bg-muted/40 px-3 py-2">
              {txHash ? (
                <TxLink hash={txHash} label={txHash} />
              ) : (
                <span className="font-mono text-xs text-muted-foreground animate-pulse">
                  0x••••••••••••••••••••••••••••••••
                </span>
              )}
            </div>
            {m.isSuccess && <Button onClick={() => close(false)}>Done</Button>}
          </div>
        ) : (
          <form
            className="mt-6 space-y-6 px-4 pb-6"
            onSubmit={(e) => {
              e.preventDefault();
              m.mutate({
                ens: fullEns,
                robot: robot.trim(),
                zoneId,
                durationHours: duration,
                permissions: perms,
              });
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="ens">Robot ENS subname</Label>
              <Input
                id="ens"
                value={ens}
                onChange={(e) => setEns(e.target.value.toLowerCase())}
                className="font-mono"
                placeholder="robot-08"
              />
              {ensParent ? (
                <p className="font-mono text-xs text-muted-foreground">{fullEns}</p>
              ) : (
                <p className="text-xs text-destructive">
                  Set the parent ENS name in Settings first.
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="robot-address">Robot address</Label>
              <Input
                id="robot-address"
                value={robot}
                onChange={(e) => setRobot(e.target.value)}
                className="font-mono"
                placeholder="0x…"
                spellCheck={false}
                aria-invalid={robot !== "" && !robotValid}
              />
              <p className="text-xs text-muted-foreground">
                The wallet that will hold this license onchain.
              </p>
            </div>

            <div className="space-y-2">
              <Label>Zone</Label>
              <Select value={zoneId} onValueChange={setZoneId}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {zones.data?.map((z) => (
                    <SelectItem key={z.id} value={z.id}>
                      {z.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {zone && (
                <div className="rounded-md border border-border bg-muted/30 p-3">
                  <ZoneMap zone={zone} className="h-32 w-full" />
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label>Lease duration</Label>
              <ToggleGroup
                type="single"
                variant="outline"
                value={String(duration)}
                onValueChange={(v) => v && setDuration(Number(v) as 1 | 8 | 24)}
                className="w-full"
              >
                {[1, 8, 24].map((h) => (
                  <ToggleGroupItem
                    key={h}
                    value={String(h)}
                    className="flex-1 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
                  >
                    {h}h
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </div>

            <div className="space-y-3">
              <Label>Permissions</Label>
              {PERMS.map((p) => (
                <label
                  key={p.id}
                  className="flex cursor-pointer items-start gap-3 rounded-md border border-border p-3 hover:bg-muted/40"
                >
                  <Checkbox
                    checked={perms.includes(p.id)}
                    onCheckedChange={(c) =>
                      setPerms((s) => (c ? [...s, p.id] : s.filter((x) => x !== p.id)))
                    }
                    className="mt-0.5"
                  />
                  <div>
                    <p className="text-sm font-medium">{p.label}</p>
                    <p className="text-xs text-muted-foreground">{p.desc}</p>
                  </div>
                </label>
              ))}
            </div>

            <div className="rounded-lg border border-primary/30 bg-primary/5 p-4">
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-primary-text">
                What this license allows
              </p>
              <ul className="space-y-1 text-sm">
                <li>
                  <span className="font-mono">{fullEns}</span> may operate inside{" "}
                  <b>{zone?.name}</b> ({zone?.width}×{zone?.height} m)
                </li>
                <li>
                  for{" "}
                  <b>
                    {duration} hour{duration > 1 ? "s" : ""}
                  </b>
                  , auto-expiring on-chain
                </li>
                <li>
                  with:{" "}
                  {perms.length ? (
                    perms.map((p) => PERMS.find((x) => x.id === p)?.label).join(", ")
                  ) : (
                    <span className="text-destructive">no permissions selected</span>
                  )}
                </li>
                <li className="text-muted-foreground">
                  Every action gated by a 0G TEE decision; safe-stop if unreachable.
                </li>
              </ul>
            </div>

            {m.isError && (
              <p
                role="alert"
                className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
              >
                {m.error.message}
                {tx?.hash && (
                  <span className="mt-1 block">
                    <TxLink hash={tx.hash} />
                  </span>
                )}
              </p>
            )}

            <div className="flex flex-col [&>button]:w-full">
              <WalletGate>
                <Button
                  type="submit"
                  disabled={!perms.length || !labelValid || !robotValid || !ensParent}
                >
                  Sign & grant license
                </Button>
              </WalletGate>
            </div>
          </form>
        )}
      </SheetContent>
    </Sheet>
  );
}

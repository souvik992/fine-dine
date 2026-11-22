import {
  couponOffText,
  formatINR,
  type CouponStatus,
  type CouponView,
} from "@dinepos/shared";
import { useQuery } from "@tanstack/react-query";
import { Pencil, Plus } from "lucide-react";
import { useState } from "react";
import {
  bpToPercentText,
  paiseToInput,
  percentToBp,
  rupeesToPaise,
} from "../billing/money-input.js";
import { useApp } from "../app-context.js";
import { Modal } from "../components/Modal.js";
import { ErrorText, SectionHeader, useSave } from "./common.js";

const STATUS: Record<CouponStatus, [string, string]> = {
  active: ["Active", "bg-primary/15 text-primary"],
  off: ["Off", "bg-muted text-muted-foreground"],
  not_started: ["Not started", "bg-muted text-muted-foreground"],
  expired: ["Ended", "bg-muted text-muted-foreground"],
  used_up: ["Used up", "bg-danger/15 text-danger"],
};

/** Settings › Coupons / Offers (as quickPOS): codes the cashier types in the bill dialog. Owner / admin only. */
export function CouponSettings() {
  const { api } = useApp();
  const list = useQuery({
    queryKey: ["coupons"],
    queryFn: () => api.get<{ coupons: CouponView[] }>("/v1/coupons"),
  });
  const [editing, setEditing] = useState<CouponView | "new" | null>(null);
  const coupons = list.data?.coupons;

  return (
    <>
      <SectionHeader
        title="Coupons / Offers"
        subtitle="Codes customers can use. In the bill dialog (F9), choose Coupon code and type the code. A coupon needs no manager PIN: you approve it here."
        action={
          <button className="btn btn-primary" onClick={() => setEditing("new")}>
            <Plus className="h-4 w-4" /> Add coupon
          </button>
        }
      />
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <table className="w-full text-sm" aria-label="Coupons">
          <thead className="bg-muted text-left">
            <tr>
              <th className="p-3">Code</th>
              <th>Takes off</th>
              <th>Minimum bill</th>
              <th>Valid</th>
              <th>Used</th>
              <th>Status</th>
              <th className="pr-3" />
            </tr>
          </thead>
          <tbody>
            {!coupons ? (
              <tr>
                <td
                  colSpan={7}
                  className="p-6 text-center text-muted-foreground"
                >
                  {list.isError ? "Could not load the coupons." : "Loading…"}
                </td>
              </tr>
            ) : coupons.length === 0 ? (
              <tr>
                <td
                  colSpan={7}
                  className="p-6 text-center text-muted-foreground"
                >
                  No coupons yet.
                </td>
              </tr>
            ) : (
              coupons.map((c) => (
                <tr
                  key={c.id}
                  className={`border-t border-border ${c.status === "active" ? "" : "text-muted-foreground"}`}
                  data-coupon={c.code}
                >
                  <td className="p-3">
                    <span className="font-mono font-semibold">{c.code}</span>
                    {c.description ? (
                      <span className="block text-xs text-muted-foreground">
                        {c.description}
                      </span>
                    ) : null}
                  </td>
                  <td>{couponOffText(c)}</td>
                  <td className="tabular-nums">
                    {c.minBillPaise ? formatINR(c.minBillPaise) : "—"}
                  </td>
                  <td className="text-xs">
                    {c.validFrom || c.validTo
                      ? `${c.validFrom ?? "now"} to ${c.validTo ?? "no end"}`
                      : "Always"}
                  </td>
                  <td className="tabular-nums">
                    {c.uses}
                    {c.maxUses ? ` of ${c.maxUses}` : ""}
                  </td>
                  <td>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS[c.status][1]}`}
                    >
                      {STATUS[c.status][0]}
                    </span>
                  </td>
                  <td className="pr-3 text-right">
                    <button
                      className="btn h-9 px-3"
                      onClick={() => setEditing(c)}
                      aria-label={`Edit ${c.code}`}
                    >
                      <Pencil className="h-4 w-4" /> Edit
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {editing ? (
        <CouponDialog
          coupon={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </>
  );
}

function CouponDialog({
  coupon,
  onClose,
}: {
  coupon: CouponView | null;
  onClose: () => void;
}) {
  const { save, busy, error, setError } = useSave();
  const [code, setCode] = useState(coupon?.code ?? "");
  const [description, setDescription] = useState(coupon?.description ?? "");
  const [kind, setKind] = useState<"pct" | "amount">(coupon?.kind ?? "pct");
  const [value, setValue] = useState(
    coupon
      ? coupon.kind === "pct"
        ? bpToPercentText(coupon.value)
        : paiseToInput(coupon.value)
      : "",
  );
  const [cap, setCap] = useState(
    coupon?.maxDiscountPaise ? paiseToInput(coupon.maxDiscountPaise) : "",
  );
  const [minBill, setMinBill] = useState(
    coupon?.minBillPaise ? paiseToInput(coupon.minBillPaise) : "",
  );
  const [from, setFrom] = useState(coupon?.validFrom ?? "");
  const [to, setTo] = useState(coupon?.validTo ?? "");
  const [maxUses, setMaxUses] = useState(
    coupon?.maxUses ? String(coupon.maxUses) : "",
  );
  const [active, setActive] = useState(coupon?.active ?? true);
  const used = Boolean(coupon && coupon.uses > 0);

  const submit = async () => {
    const v = kind === "pct" ? percentToBp(value) : rupeesToPaise(value);
    if (!v)
      return setError(
        kind === "pct"
          ? "Enter the percentage, like 10."
          : "Enter the amount in rupees, like 50.",
      );
    const capP = cap.trim() ? rupeesToPaise(cap) : null;
    if (cap.trim() && !capP)
      return setError("“Up to” must be an amount in rupees.");
    const minP = rupeesToPaise(minBill);
    if (minP === null)
      return setError("Minimum bill must be an amount in rupees.");
    const uses = maxUses.trim() ? Number(maxUses) : null;
    if (uses !== null && (!Number.isInteger(uses) || uses < 1))
      return setError(
        "Number of uses must be a whole number (empty = no limit).",
      );
    const ok = await save("UpsertCoupon", {
      ...(coupon ? { couponId: coupon.id } : {}),
      code: code.trim().toUpperCase(),
      description: description.trim() || null,
      kind,
      value: v,
      maxDiscountPaise: kind === "pct" ? capP : null,
      minBillPaise: minP,
      validFrom: from || null,
      validTo: to || null,
      maxUses: uses,
      active,
    });
    if (ok) onClose();
  };

  const label = "block text-sm font-semibold";
  return (
    <Modal
      title={coupon ? `Edit coupon ${coupon.code}` : "Add coupon"}
      onClose={onClose}
    >
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="grid grid-cols-2 gap-3">
          <label className={label}>
            Code
            <input
              data-autofocus
              className="input mt-1 font-mono uppercase"
              maxLength={20}
              value={code}
              disabled={used}
              onChange={(e) =>
                setCode(
                  e.target.value.replace(/[^A-Za-z0-9-]/g, "").toUpperCase(),
                )
              }
              placeholder="SAVE10"
              aria-label="Coupon code"
            />
          </label>
          <label className={label}>
            Note (optional)
            <input
              className="input mt-1 font-normal"
              maxLength={80}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Diwali offer"
              aria-label="Note"
            />
          </label>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className={label}>
            Takes off
            <div className="mt-1 flex gap-1.5">
              <div
                role="radiogroup"
                aria-label="Coupon type"
                className="flex rounded-lg border border-border p-0.5"
              >
                {(["pct", "amount"] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    role="radio"
                    aria-checked={kind === k}
                    onClick={() => setKind(k)}
                    className={`h-9 rounded-md px-3 text-sm font-semibold ${kind === k ? "bg-foreground text-background" : ""}`}
                  >
                    {k === "pct" ? "%" : "₹"}
                  </button>
                ))}
              </div>
              <input
                className="input min-w-0 flex-1 font-normal"
                inputMode="decimal"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={kind === "pct" ? "10" : "50"}
                aria-label="How much"
              />
            </div>
          </div>
          {kind === "pct" ? (
            <label className={label}>
              Up to (₹, optional)
              <input
                className="input mt-1 font-normal"
                inputMode="decimal"
                value={cap}
                onChange={(e) => setCap(e.target.value)}
                placeholder="no limit"
                aria-label="Maximum discount"
              />
            </label>
          ) : null}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className={label}>
            Minimum bill (₹)
            <input
              className="input mt-1 font-normal"
              inputMode="decimal"
              value={minBill}
              onChange={(e) => setMinBill(e.target.value)}
              placeholder="none"
              aria-label="Minimum bill"
            />
          </label>
          <label className={label}>
            Number of uses
            <input
              className="input mt-1 font-normal"
              inputMode="numeric"
              value={maxUses}
              onChange={(e) => setMaxUses(e.target.value.replace(/\D/g, ""))}
              placeholder="no limit"
              aria-label="Number of uses"
            />
          </label>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className={label}>
            From (optional)
            <input
              className="input mt-1 font-normal"
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              aria-label="Valid from"
            />
          </label>
          <label className={label}>
            To (optional)
            <input
              className="input mt-1 font-normal"
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              aria-label="Valid to"
            />
          </label>
        </div>
        <label className="flex items-center gap-2 text-sm font-semibold">
          <input
            type="checkbox"
            checked={active}
            onChange={(e) => setActive(e.target.checked)}
          />{" "}
          Active (can be used)
        </label>
        <p className="text-xs text-muted-foreground">
          The minimum bill is the bill total before the coupon. A coupon is
          taken off before GST, like a discount. A used coupon keeps its code;
          to replace it, switch it off and add a new one.
        </p>
        <ErrorText error={error} />
        <div className="flex justify-end gap-2">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={busy || code.trim().length < 3}
          >
            {busy ? "Saving…" : "Save coupon"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

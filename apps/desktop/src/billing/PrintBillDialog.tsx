import {
  calculateBill,
  couponOff,
  couponOffText,
  couponProblem,
  formatINR,
  type CouponView,
  type OrderSnapshot,
  type OutletConfig,
} from "@dinepos/shared";
import { Ticket, X } from "lucide-react";
import { useState } from "react";
import { ApiError } from "../api/client.js";
import { useApp } from "../app-context.js";
import { Modal } from "../components/Modal.js";
import { bpToPercentText, percentToBp, rupeesToPaise } from "./money-input.js";
import type { OrderSession } from "./order-session.js";

const REASONS = [
  "Regular guest",
  "Staff meal",
  "Manager approval",
  "Service delay",
];

/**
 * Print bill (F9). The preview uses the shared calculator with the outlet settings; the printed figures are the
 * server's (same code, server-side). Enter prints, Esc cancels.
 */
export function PrintBillDialog({
  order,
  config,
  session,
  onDone,
  onClose,
}: {
  order: OrderSnapshot;
  config: OutletConfig;
  session: OrderSession;
  onDone: (billNo: string, warning?: string) => void;
  onClose: () => void;
}) {
  const { api } = useApp();
  // Discount, or a coupon code (Settings › Coupons / Offers, as quickPOS): a coupon is the bill discount
  const [mode, setMode] = useState<"discount" | "coupon">("discount");
  const [code, setCode] = useState("");
  const [coupon, setCoupon] = useState<{
    view: CouponView;
    today: string;
  } | null>(null);
  const [couponError, setCouponError] = useState<string | null>(null);
  const [kind, setKind] = useState<"pct" | "amount">("pct");
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const [service, setService] = useState(false);
  // a takeaway / delivery order already knows who it is for
  const [guest, setGuest] = useState({
    name: order.customer?.name ?? "",
    phone: order.customer?.phone ?? "",
    gstin: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsed =
    mode === "coupon"
      ? 0
      : kind === "pct"
        ? percentToBp(value)
        : rupeesToPaise(value);
  const scRate = config["bill.serviceChargeBp"];
  const fired = order.items.filter((i) => i.status === "fired");
  let preview: ReturnType<typeof calculateBill> | null = null;
  let previewError: string | null =
    parsed === null
      ? kind === "pct"
        ? "Enter a percentage up to 100."
        : "Enter an amount in rupees."
      : null;
  const billLines = fired.map((i) => ({
    id: i.id,
    qty: i.qty,
    unitPricePaise: i.unitPricePaise,
    taxRateBp: i.taxRateBp,
    addons: i.addons,
  }));
  const calcOptions = {
    serviceChargeBp: service ? scRate : 0,
    roundOffStep: config["bill.roundOffStep"],
    roundOffTie: config["bill.roundOffTie"],
  };
  // the coupon on this bill: what it takes off, or why it cannot be used (the server checks again when printing)
  let couponOffPaise = 0;
  let couponIssue: string | null = null;
  if (mode === "coupon" && coupon) {
    const before = calculateBill(billLines, { ...calcOptions, discount: null });
    couponIssue = couponProblem(
      coupon.view,
      coupon.view.uses,
      coupon.today,
      before.total,
    );
    if (!couponIssue) couponOffPaise = couponOff(coupon.view, before.subtotal);
  }
  if (parsed !== null) {
    try {
      const typed =
        parsed > 0
          ? kind === "pct"
            ? ({ kind: "pct", valueBp: parsed } as const)
            : ({ kind: "amount", valuePaise: parsed } as const)
          : null;
      preview = calculateBill(billLines, {
        ...calcOptions,
        discount:
          couponOffPaise > 0
            ? { kind: "amount", valuePaise: couponOffPaise }
            : typed,
      });
    } catch {
      previewError = "The discount is more than the bill.";
    }
  }
  // A typed code not applied yet, or a coupon that cannot be used, stops the print. "Used up" may be this bill's own
  // use (printing it again after more items), so the server decides that one.
  const couponBlocks =
    mode === "coupon" &&
    (coupon
      ? Boolean(couponIssue) && coupon.view.status !== "used_up"
      : code.trim() !== "");

  const applyCoupon = async () => {
    const c = code.trim().toUpperCase();
    if (c.length < 3) return setCouponError("Type the coupon code.");
    setCouponError(null);
    try {
      const r = await api.get<{ coupon: CouponView; today: string }>(
        `/v1/coupons/${encodeURIComponent(c)}`,
      );
      setCoupon({ view: r.coupon, today: r.today });
    } catch (e) {
      setCoupon(null);
      setCouponError(
        e instanceof ApiError ? e.message : "Could not check the coupon.",
      );
    }
  };
  const needsReason = (parsed ?? 0) > 0 && !reason.trim();

  const submit = async () => {
    if (!preview || needsReason || couponBlocks || busy) return;
    setBusy(true);
    setError(null);
    try {
      const customer =
        guest.name || guest.phone || guest.gstin
          ? {
              name: guest.name.trim() || null,
              phone: guest.phone.trim() || null,
              gstin: guest.gstin.trim() || null,
            }
          : null;
      const res = await session.run<{ billNo: string; warning?: string }>(
        "PrintBill",
        {
          discount:
            (parsed ?? 0) > 0
              ? { kind, value: parsed, reason: reason.trim() }
              : null,
          coupon: mode === "coupon" && coupon ? coupon.view.code : null,
          serviceCharge: service ? { enabled: true } : null,
          customer,
        },
      );
      onDone(res.result.billNo, res.result.warning);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not print the bill.");
      setBusy(false);
    }
  };

  const row = (label: string, amount: number, strong = false) => (
    <div
      className={`flex justify-between ${strong ? "text-lg font-bold" : ""}`}
    >
      <span className={strong ? "" : "text-muted-foreground"}>{label}</span>
      <span className="tabular-nums">
        {amount < 0 ? `-${formatINR(-amount)}` : formatINR(amount)}
      </span>
    </div>
  );

  return (
    <Modal title="Print bill" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div
          className="mb-2 flex gap-1.5"
          role="tablist"
          aria-label="Coupon or discount"
        >
          {(
            [
              ["discount", "Discount"],
              ["coupon", "Coupon code"],
            ] as const
          ).map(([m, label]) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              className="tab"
              onClick={() => setMode(m)}
            >
              {label}
            </button>
          ))}
        </div>
        {mode === "coupon" ? (
          <fieldset className="mb-3">
            <legend className="sr-only">Coupon code</legend>
            {coupon ? (
              <div
                className={`flex items-center gap-2 rounded-lg border p-2 text-sm ${couponIssue ? "border-danger/40 text-danger" : "border-primary bg-accent text-primary"}`}
              >
                <Ticket className="h-4 w-4 shrink-0" />
                <span className="min-w-0 flex-1">
                  <b className="font-mono">{coupon.view.code}</b> ·{" "}
                  {couponOffText(coupon.view)}
                  {coupon.view.description ? (
                    <span className="text-muted-foreground">
                      {" "}
                      · {coupon.view.description}
                    </span>
                  ) : null}
                </span>
                <span className="font-semibold tabular-nums">
                  {couponIssue
                    ? "not applied"
                    : `-${formatINR(couponOffPaise)}`}
                </span>
                <button
                  type="button"
                  className="rounded p-1 text-muted-foreground hover:text-danger"
                  aria-label="Remove coupon"
                  onClick={() => {
                    setCoupon(null);
                    setCode("");
                  }}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <div className="flex gap-2">
                <input
                  autoFocus
                  className="input flex-1 font-mono uppercase"
                  aria-label="Coupon code"
                  placeholder="e.g. SAVE10"
                  maxLength={20}
                  value={code}
                  onChange={(e) =>
                    setCode(
                      e.target.value
                        .replace(/[^A-Za-z0-9-]/g, "")
                        .toUpperCase(),
                    )
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void applyCoupon();
                    }
                  }}
                />
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => void applyCoupon()}
                >
                  Apply
                </button>
              </div>
            )}
            {couponIssue ? (
              <p
                role="alert"
                className="mt-1 text-sm font-semibold text-danger"
              >
                {couponIssue}
              </p>
            ) : null}
            {couponError ? (
              <p
                role="alert"
                className="mt-1 text-sm font-semibold text-danger"
              >
                {couponError}
              </p>
            ) : null}
          </fieldset>
        ) : (
          <fieldset className="mb-3">
            <legend className="sr-only">Discount</legend>
            <div className="flex gap-2">
              <div
                role="radiogroup"
                aria-label="Discount type"
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
                data-autofocus
                className="input w-28 text-right tabular-nums"
                inputMode="decimal"
                aria-label={
                  kind === "pct" ? "Discount percent" : "Discount amount"
                }
                placeholder="0"
                value={value}
                onChange={(e) => setValue(e.target.value)}
              />
              <input
                className="input flex-1"
                list="discount-reasons"
                aria-label="Discount reason"
                placeholder="Reason (needed for a discount)"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
              <datalist id="discount-reasons">
                {REASONS.map((r) => (
                  <option key={r} value={r} />
                ))}
              </datalist>
            </div>
          </fieldset>
        )}

        <label
          className={`mb-3 flex items-center gap-2 text-sm font-semibold ${scRate ? "" : "opacity-50"}`}
        >
          <input
            type="checkbox"
            checked={service}
            disabled={!scRate}
            onChange={(e) => setService(e.target.checked)}
          />
          Add service charge{" "}
          {scRate
            ? `(${bpToPercentText(scRate)}%) — only if the guest agrees`
            : "(not set up)"}
        </label>

        <details className="mb-3 rounded-lg border border-border p-3">
          <summary className="cursor-pointer text-sm font-semibold">
            Guest details (optional, for a GST bill)
          </summary>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <input
              className="input"
              aria-label="Guest name"
              placeholder="Name"
              value={guest.name}
              onChange={(e) => setGuest({ ...guest, name: e.target.value })}
            />
            <input
              className="input"
              aria-label="Guest phone"
              placeholder="Phone"
              value={guest.phone}
              onChange={(e) => setGuest({ ...guest, phone: e.target.value })}
            />
            <input
              className="input col-span-2 uppercase"
              aria-label="Guest GSTIN"
              placeholder="GSTIN"
              maxLength={15}
              value={guest.gstin}
              onChange={(e) =>
                setGuest({ ...guest, gstin: e.target.value.toUpperCase() })
              }
            />
          </div>
        </details>

        <div
          className="space-y-1 rounded-lg bg-secondary p-3 text-sm"
          aria-label="Bill preview"
        >
          {preview ? (
            <>
              {row("Subtotal", preview.subtotal)}
              {preview.discount
                ? row(
                    couponOffPaise > 0 && coupon
                      ? `Coupon ${coupon.view.code}`
                      : "Discount",
                    -preview.discount,
                  )
                : null}
              {preview.serviceCharge
                ? row("Service charge", preview.serviceCharge)
                : null}
              {row("GST", preview.totalTax)}
              {preview.roundOff ? row("Round off", preview.roundOff) : null}
              {row("Total", preview.total, true)}
            </>
          ) : (
            <p className="font-semibold text-danger">{previewError}</p>
          )}
        </div>

        {needsReason ? (
          <p className="mt-2 text-sm font-semibold text-danger">
            Pick or type a reason for the discount.
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="mt-2 text-sm font-semibold text-danger">
            {error}
          </p>
        ) : null}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={!preview || needsReason || couponBlocks || busy}
          >
            {busy ? "Printing…" : "Print bill"}{" "}
            <kbd className="text-xs opacity-80">Enter</kbd>
          </button>
        </div>
      </form>
    </Modal>
  );
}

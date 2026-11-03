import type { FloorSnapshot } from "@dinepos/shared";
import { useQuery } from "@tanstack/react-query";
import { ReceiptText } from "lucide-react";
import { useEffect, useState } from "react";
import { useApp } from "../app-context.js";
import { billRequests, elapsedMinutes, formatElapsed } from "./floor-model.js";

/**
 * "Request bill" from the captains (docs/09 "notifies desk"), on every screen of the terminal until the bill is
 * printed. Driven by the floor (the `bill.requested` event refreshes it), so nothing is missed across reconnects.
 * `compact` (on the order and other screens): one small line each, so menu tiles stay usable.
 */
export function BillRequests({
  onOpen,
  hiddenOrderId,
  compact = false,
}: {
  onOpen: (orderId: string) => void;
  hiddenOrderId?: string;
  compact?: boolean;
}) {
  const { api, can } = useApp();
  const floor = useQuery({
    queryKey: ["floor"],
    queryFn: () => api.get<FloorSnapshot>("/v1/floor"),
    refetchInterval: 30_000,
  });
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);
  if (!can("bill.print", true)) return null;
  const list = billRequests(floor.data).filter(
    (t) => t.orderId !== hiddenOrderId,
  );
  if (list.length === 0) return null;
  return (
    <aside
      className={`fixed left-4 z-40 flex max-w-sm flex-col gap-2 ${compact ? "bottom-2" : "bottom-4"}`}
      aria-label="Bill requests"
    >
      {list.map((t) =>
        compact ? (
          <button
            key={t.id}
            className="flex w-fit items-center gap-1.5 rounded-full border border-[var(--bill-ink)] bg-[var(--bill)] px-3 py-1 text-xs font-bold text-[var(--bill-ink)] shadow"
            onClick={() => onOpen(t.orderId!)}
            data-bill-request={t.label}
          >
            <ReceiptText className="h-3.5 w-3.5" /> Table {t.label} asks for the
            bill
          </button>
        ) : (
          <button
            key={t.id}
            className="flex items-center gap-3 rounded-xl border-2 border-[var(--bill-ink)] bg-[var(--bill)] px-4 py-2.5 text-left text-[var(--bill-ink)] shadow-lg hover:brightness-95"
            onClick={() => onOpen(t.orderId!)}
            data-bill-request={t.label}
          >
            <ReceiptText className="h-5 w-5 shrink-0" />
            <span>
              <span className="block font-bold">
                Table {t.label} asks for the bill
              </span>
              <span className="block text-xs">
                {t.billRequest!.byName ? `${t.billRequest!.byName} · ` : ""}
                {formatElapsed(elapsedMinutes(t.billRequest!.at, now)) ||
                  "just now"}
              </span>
            </span>
          </button>
        ),
      )}
    </aside>
  );
}

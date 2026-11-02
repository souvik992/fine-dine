// Post-commit side effects. Nothing here runs inside a transaction (CLAUDE.md pipeline rule).

export interface PublishedEvent {
  seq: number;
  topic: string;
  event: string;
  at: string;
  data: unknown;
}

export type EventListener = (event: PublishedEvent) => void;

/** In-process fan-out of committed events. The WS hub (realtime/hub.ts) subscribes to it. */
export class EventBus {
  private readonly listeners = new Set<EventListener>();

  subscribe(listener: EventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Delivers to every listener; one failing listener never stops the others. Returns the errors. */
  publish(events: readonly PublishedEvent[]): unknown[] {
    const errors: unknown[] = [];
    for (const e of events) {
      for (const l of this.listeners) {
        try {
          l(e);
        } catch (err) {
          errors.push(err);
        }
      }
    }
    return errors;
  }
}

/** Wakes print workers for printers that got new jobs (P1-07 implements the worker). */
export interface PrintWaker {
  wake(printerIds: readonly string[]): void;
}

export const noopPrintWaker: PrintWaker = { wake: () => undefined };

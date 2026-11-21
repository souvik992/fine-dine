-- 0018_counter_orders.sql — takeaway and delivery orders opened from the floor (OpenCounterOrder): a ticket number for
-- the business day ("Takeaway #12", shared by takeaway and delivery) and where a delivery goes. Both stay NULL on
-- dine-in and online orders.
ALTER TABLE "order" ADD COLUMN ticket_no INTEGER;
ALTER TABLE "order" ADD COLUMN delivery_address TEXT;
CREATE INDEX idx_order_counter ON "order"(state) WHERE table_id IS NULL AND type IN ('takeaway', 'delivery');

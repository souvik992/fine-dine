-- 0017_purchases_to_cloud.sql — purchases go up to PosiNext Cloud for the portal's "Purchases & stock" page (the cloud
-- reads `purchase.recorded` / `purchase.voided` from the outbox, hub/src/inventory.ts). New purchases write their
-- outbox row themselves (commands/record-purchase.ts); this sends the ones recorded before, once, oldest first.
-- Voided purchases are left out (the page does not show them). No table changes.
INSERT INTO outbox (kind, payload_json, created_at)
SELECT 'purchase.recorded',
       json_object(
         'purchaseId', p.id, 'supplier', p.supplier_name, 'billNo', p.invoice_no, 'businessDate', p.business_date, 'totalPaise', p.total_paise,
         'lines', json((SELECT json_group_array(json_object('name', s.name, 'unit', s.unit, 'qtyMilli', l.qty_milli, 'amountPaise', l.amount_paise))
                   FROM purchase_line l JOIN stock_item s ON s.id = l.stock_item_id WHERE l.purchase_id = p.id))
       ),
       p.created_at
FROM purchase p WHERE p.status = 'posted' ORDER BY p.created_at, p.id;

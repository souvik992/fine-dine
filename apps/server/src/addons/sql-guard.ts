// A safety net for add-on database steps (P5-01): they may create and change only their own tables (`<id>_...`).
// It reads the SQL text, so it catches mistakes; it is not a sandbox (ADR-0004 "Known limits").

/** Splits on `;` outside quotes, after removing comments. */
function statements(sql: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quote: string | null = null;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i]!;
    if (quote) {
      cur += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
      cur += ch;
    } else if (ch === '-' && sql[i + 1] === '-') {
      while (i < sql.length && sql[i] !== '\n') i++;
    } else if (ch === '/' && sql[i + 1] === '*') {
      i = sql.indexOf('*/', i + 2);
      if (i < 0) break;
      i++;
    } else if (ch === ';') {
      if (cur.trim()) out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

const name = (s: string) => s.replace(/^["`[]|["`\]]$/g, '').toLowerCase();

/** Null when every statement only touches `<id>_` tables; otherwise why not. */
export function sqlProblem(id: string, sql: string): string | null {
  const own = (t: string) => name(t).startsWith(`${id}_`);
  const list = statements(sql);
  if (list.length === 0) return 'The database step is empty.';
  for (const st of list) {
    const s = st.replace(/\s+/g, ' ');
    if (/^(ATTACH|DETACH|PRAGMA|VACUUM|REINDEX|ANALYZE|BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE)\b/i.test(s)) return `Not allowed in an add-on database step: ${s.slice(0, 40)}`;
    if (/^CREATE (TEMP |TEMPORARY )?(TRIGGER|VIEW|VIRTUAL TABLE)\b/i.test(s)) return 'Add-on database steps may not create triggers, views or virtual tables.';
    let m = /^CREATE (?:TEMP |TEMPORARY )?TABLE (?:IF NOT EXISTS )?([^\s(]+)/i.exec(s);
    if (m) {
      if (!own(m[1]!)) return `The table ${m[1]} must be named ${id}_...`;
      continue;
    }
    m = /^CREATE (?:UNIQUE )?INDEX (?:IF NOT EXISTS )?([^\s(]+) ON ([^\s(]+)/i.exec(s);
    if (m) {
      if (!own(m[1]!) || !own(m[2]!)) return `Indexes must be named ${id}_... and be on ${id}_ tables.`;
      continue;
    }
    m = /^(?:ALTER TABLE|DROP TABLE(?: IF EXISTS)?|DROP INDEX(?: IF EXISTS)?|INSERT(?: OR \w+)? INTO|REPLACE INTO|UPDATE(?: OR \w+)?|DELETE FROM) ([^\s(]+)/i.exec(s);
    if (m) {
      if (!own(m[1]!)) return `An add-on may change only its own tables (${id}_...), not ${m[1]}.`;
      if (/^ALTER TABLE \S+ RENAME TO (\S+)/i.test(s) && !own(/RENAME TO (\S+)/i.exec(s)![1]!)) return `Renamed tables must stay ${id}_...`;
      if (/\bSELECT\b/i.test(s) && !/^INSERT/i.test(s)) continue;
      continue;
    }
    return `Not allowed in an add-on database step: ${s.slice(0, 40)}`;
  }
  return null;
}

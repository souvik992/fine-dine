// The bytes an add-on signature covers. Must stay identical to canonicalManifest() in packages/shared/src/addons.ts
// (src/package.test.ts checks they agree).

function stable(v) {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v)
      .filter((k) => v[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable(v[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v);
}

/** Every field except `signature`, keys sorted at every level, no spaces. */
export function canonicalManifest(m) {
  const { signature: _signature, ...rest } = m;
  return stable(rest);
}

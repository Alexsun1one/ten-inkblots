// The JSON Schema subset protocol.schema.json uses. Zero dependencies; cross-checked against ajv in development.
export function checkSchema(root, value) {
  const errors = [];
  const typeOf = v => (v === null ? 'null' : Array.isArray(v) ? 'array' : Number.isInteger(v) ? 'integer' : typeof v);
  const matches = (t, v) => { const k = typeOf(v); return t === k || (t === 'number' && k === 'integer'); };
  const walk = (s, v, at) => {
    if (s.$ref) return walk(s.$ref.slice(2).split('/').reduce((o, k) => o[k], root), v, at);
    if (s.anyOf) {
      const tries = s.anyOf.map(o => { const before = errors.length; walk(o, v, at); return errors.splice(before); });
      if (tries.some(e => !e.length)) return;
      // Report the branch that matched the value's type: "should be null" says nothing about a broken object.
      const shape = tries.filter(e => !e.some(m => m.startsWith(`${at}: 应为`)));
      errors.push(...(shape.length ? shape : tries).reduce((a, b) => (b.length < a.length ? b : a)));
      return;
    }
    if (s.type && ![].concat(s.type).some(t => matches(t, v))) { errors.push(`${at}: 应为 ${[].concat(s.type).join('|')}，实际 ${typeOf(v)}`); return; }
    if ('const' in s && v !== s.const) errors.push(`${at}: 应为 ${JSON.stringify(s.const)}`);
    if (s.enum && !s.enum.includes(v)) errors.push(`${at}: ${JSON.stringify(v)} 不在 ${JSON.stringify(s.enum)}`);
    if (typeof v === 'number') {
      if (s.minimum != null && v < s.minimum) errors.push(`${at}: ${v} 小于 ${s.minimum}`);
      if (s.maximum != null && v > s.maximum) errors.push(`${at}: ${v} 大于 ${s.maximum}`);
    }
    if (typeof v === 'string') {
      if (s.minLength != null && v.length < s.minLength) errors.push(`${at}: 长度不足 ${s.minLength}`);
      if (s.pattern && !new RegExp(s.pattern).test(v)) errors.push(`${at}: ${JSON.stringify(v)} 不符合 ${s.pattern}`);
    }
    if (Array.isArray(v)) {
      if (s.minItems != null && v.length < s.minItems) errors.push(`${at}: 少于 ${s.minItems} 项`);
      if (s.maxItems != null && v.length > s.maxItems) errors.push(`${at}: 多于 ${s.maxItems} 项`);
      const head = s.prefixItems || [];
      head.forEach((p, i) => { if (i < v.length) walk(p, v[i], `${at}[${i}]`); });
      if (s.items) v.slice(head.length).forEach((x, i) => walk(s.items, x, `${at}[${i + head.length}]`));
    }
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      for (const k of s.required || []) if (!(k in v)) errors.push(`${at}: 缺少 ${k}`);
      for (const [k, x] of Object.entries(v)) {
        if (s.properties?.[k]) walk(s.properties[k], x, `${at}.${k}`);
        else if (s.additionalProperties === false) errors.push(`${at}: 多余字段 ${k}`);
        else if (s.additionalProperties && typeof s.additionalProperties === 'object') walk(s.additionalProperties, x, `${at}.${k}`);
      }
    }
  };
  walk(root, value, '$');
  return errors;
}

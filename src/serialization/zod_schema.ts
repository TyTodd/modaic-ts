/**
 * Zod -> JSON Schema walker that reproduces the Python SDK's
 * `serializers.py::serialize_signature` dialect (pydantic `model_json_schema`).
 *
 * Only the slice of JSON Schema that the Python deserializer
 * (`_deserialize_dspy_signatures` + `json_to_type`) understands is emitted, plus
 * the dspy field extras (`__dspy_field_type`, `desc`, `prefix`, `title`). Special
 * modaic types (Image/Audio/Scale) are detected via a `.meta().__modaic_type`
 * marker — see `src/signatures/types.ts`.
 */

export type JsonSchema = Record<string, any>;

/** Internal `_def`/`def` accessor (zod's shape differs slightly across builds). */
function defOf(schema: any): any {
  return schema?._def ?? schema?.def ?? {};
}

/** Read a schema's registered metadata, tolerant of schemas without `.meta`. */
function metaOf(schema: any): Record<string, any> {
  try {
    return (typeof schema?.meta === "function" ? schema.meta() : undefined) ?? {};
  } catch {
    return {};
  }
}

/** True for `z.any()` / `z.unknown()` — used to emit empty `items` / open objects. */
function isOpen(schema: any): boolean {
  if (!schema) return true;
  const t = defOf(schema).type;
  return t === "any" || t === "unknown";
}

/** Integer detection: `z.int()` reports type "number" with an int `format`. */
function isInteger(schema: any): boolean {
  const d = defOf(schema);
  if (typeof d.format === "string" && d.format.includes("int")) return true;
  const checks = d.checks ?? [];
  return checks.some((c: any) => {
    const f = c?._def?.format ?? c?.format ?? c?._def?.check ?? "";
    return typeof f === "string" && f.includes("int");
  });
}

interface Unwrapped {
  /** The innermost schema after stripping optional/default/nullable wrappers. */
  core: any;
  /** Merged `.meta()` across the wrapper chain (outer wins). */
  meta: Record<string, any>;
  hasDefault: boolean;
  defaultValue?: any;
  optional: boolean;
  nullable: boolean;
}

/** Strip optional/default/nullable wrappers, collecting their effects + metadata. */
function unwrap(schema: any): Unwrapped {
  let cur = schema;
  let hasDefault = false;
  let defaultValue: any;
  let optional = false;
  let nullable = false;
  const metas: Record<string, any>[] = [];

  // Walk outer -> inner.
  // Guard against pathological cycles with a generous bound.
  for (let i = 0; i < 100; i++) {
    metas.push(metaOf(cur));
    const d = defOf(cur);
    if (d.type === "optional") {
      optional = true;
      cur = d.innerType;
    } else if (d.type === "default" || d.type === "prefault") {
      hasDefault = true;
      defaultValue =
        typeof d.defaultValue === "function" ? d.defaultValue() : d.defaultValue;
      cur = d.innerType;
    } else if (d.type === "nullable") {
      nullable = true;
      cur = d.innerType;
    } else {
      break;
    }
  }

  // Merge inner-first so an outer `.meta()`/`.describe()` overrides an inner one.
  let meta: Record<string, any> = {};
  for (let i = metas.length - 1; i >= 0; i--) {
    meta = { ...meta, ...metas[i] };
  }

  return { core: cur, meta, hasDefault, defaultValue, optional, nullable };
}

/** Pretty title from a field name: `name.replace("_"," ")` then Python `str.title()`. */
export function pydanticTitle(name: string): string {
  return name
    .replace(/_/g, " ")
    .replace(/[A-Za-z]+/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}

/** Field description: `.describe()`/`.meta({desc})`, falling back to dspy's `${name}`. */
export function fieldDesc(meta: Record<string, any>, name: string): string {
  return meta.description ?? meta.desc ?? `\${${name}}`;
}

/** The JSON-Schema "type fragment" for a leaf/container schema (no field extras). */
function coreFragment(
  core: any,
  meta: Record<string, any>,
  defs: Record<string, JsonSchema>,
): JsonSchema {
  const modaicType = meta.__modaic_type;

  // Special modaic types (Image/Audio/Scale) are identified by the marker, not structure.
  if (modaicType === "image" || modaicType === "audio") {
    const name = modaicType === "image" ? "Image" : "Audio";
    defs[name] = { type: `dspy.${name}` };
    return { $ref: `#/$defs/${name}` };
  }
  if (modaicType === "scale") {
    const lo = Number(meta.lo);
    const hi = Number(meta.hi);
    const values: number[] = [];
    for (let v = lo; v <= hi; v++) values.push(v);
    return { enum: values, type: "integer" };
  }

  const d = defOf(core);
  switch (d.type) {
    case "string":
      return { type: "string" };
    case "boolean":
      return { type: "boolean" };
    case "number":
      return { type: isInteger(core) ? "integer" : "number" };
    case "bigint":
      return { type: "integer" };
    case "enum":
      return enumFragment(core);
    case "literal":
      return literalFragment(core);
    case "array":
      return arrayFragment(core, defs);
    case "record":
    case "map":
      return recordFragment(core, defs);
    case "tuple":
      return tupleFragment(core, defs);
    case "union":
      return unionFragment(core, defs);
    case "object":
      return objectFragment(core, defs);
    default:
      // dspy's behavior for unknown/untyped fields is a bare string.
      return { type: "string" };
  }
}

function enumValues(core: any): any[] {
  const opts = core?.options;
  if (Array.isArray(opts)) return opts;
  const entries = defOf(core).entries ?? defOf(core).values;
  if (entries && typeof entries === "object") return Object.values(entries);
  return Array.isArray(entries) ? entries : [];
}

function enumFragment(core: any): JsonSchema {
  // pydantic serializes a single allowed value as `const`, many as `enum` — matching
  // how `modaic.Enum[...]` delegates to a `Literal` (see Python `modaic/types.py`).
  return enumOrConst(enumValues(core));
}

/** `{const}` for one value, `{enum}` for many; integer-typed when all values are numbers. */
function enumOrConst(values: any[]): JsonSchema {
  const allNumbers = values.length > 0 && values.every((v) => typeof v === "number");
  const type = allNumbers ? "integer" : "string";
  if (values.length === 1) {
    return { const: values[0], type };
  }
  return { enum: values, type };
}

function literalFragment(core: any): JsonSchema {
  const raw = defOf(core).values;
  const values = Array.isArray(raw) ? raw : raw != null ? [...raw] : [];
  const typeOf = (v: any): string =>
    typeof v === "number"
      ? Number.isInteger(v)
        ? "integer"
        : "number"
      : typeof v === "boolean"
        ? "boolean"
        : "string";
  if (values.length === 1) {
    return { const: values[0], type: typeOf(values[0]) };
  }
  const allNumbers = values.every((v) => typeof v === "number");
  return { enum: values, type: allNumbers ? "integer" : "string" };
}

function arrayFragment(core: any, defs: Record<string, JsonSchema>): JsonSchema {
  const el = defOf(core).element;
  return { type: "array", items: el && !isOpen(el) ? typeFragment(el, defs) : {} };
}

function recordFragment(core: any, defs: Record<string, JsonSchema>): JsonSchema {
  const val = defOf(core).valueType;
  if (!val || isOpen(val)) {
    return { type: "object", additionalProperties: true };
  }
  return { type: "object", additionalProperties: typeFragment(val, defs) };
}

function tupleFragment(core: any, defs: Record<string, JsonSchema>): JsonSchema {
  const items: any[] = defOf(core).items ?? [];
  const prefixItems = items.map((it) => typeFragment(it, defs));
  return {
    type: "array",
    maxItems: prefixItems.length,
    minItems: prefixItems.length,
    prefixItems,
  };
}

function unionFragment(core: any, defs: Record<string, JsonSchema>): JsonSchema {
  const options: any[] = defOf(core).options ?? [];
  return { anyOf: options.map((o) => typeFragment(o, defs)) };
}

/**
 * Nested object (anonymous). pydantic hoists named models into `$defs`; TS objects
 * are anonymous, so we inline a best-effort object schema. Nested models are rare
 * in pure-judge arbiters — primitives + special types are the common case.
 */
function objectFragment(core: any, defs: Record<string, JsonSchema>): JsonSchema {
  const shape: Record<string, any> = core?.shape ?? defOf(core).shape ?? {};
  const properties: Record<string, JsonSchema> = {};
  const required: string[] = [];
  for (const [name, fieldSchema] of Object.entries(shape)) {
    const info = serializeField(fieldSchema, defs);
    properties[name] = info.fragment;
    if (!info.hasDefault && !info.optional) required.push(name);
  }
  return { type: "object", properties, required };
}

/** Type fragment for a value position (array item, record value, union option). */
function typeFragment(schema: any, defs: Record<string, JsonSchema>): JsonSchema {
  return serializeField(schema, defs).fragment;
}

export interface FieldInfo {
  fragment: JsonSchema;
  /** True when the fragment is a bare `$ref` (pydantic omits a field-level `title`). */
  isRef: boolean;
  optional: boolean;
  hasDefault: boolean;
  defaultValue?: any;
  meta: Record<string, any>;
}

/** Serialize a single Zod field schema into its JSON-Schema fragment + metadata. */
export function serializeField(
  schema: any,
  defs: Record<string, JsonSchema>,
): FieldInfo {
  const u = unwrap(schema);
  let fragment = coreFragment(u.core, u.meta, defs);
  const isRef = typeof fragment.$ref === "string";
  if (u.nullable) {
    fragment = { anyOf: [fragment, { type: "null" }] };
  }
  return {
    fragment,
    isRef,
    optional: u.optional,
    hasDefault: u.hasDefault,
    defaultValue: u.defaultValue,
    meta: u.meta,
  };
}

/**
 * Recursively sort object keys alphabetically to match pydantic's output, with two
 * exceptions: the children of `properties` keep declaration order (inputs then
 * outputs), and `default` payloads are left untouched.
 */
export function sortSchema(node: any): any {
  if (Array.isArray(node)) return node.map(sortSchema);
  if (node && typeof node === "object") {
    const out: Record<string, any> = {};
    for (const key of Object.keys(node).sort()) {
      const value = node[key];
      if (key === "properties" && value && typeof value === "object" && !Array.isArray(value)) {
        const props: Record<string, any> = {};
        for (const fieldName of Object.keys(value)) {
          props[fieldName] = sortSchema(value[fieldName]);
        }
        out[key] = props;
      } else if (key === "default") {
        out[key] = value;
      } else {
        out[key] = sortSchema(value);
      }
    }
    return out;
  }
  return node;
}

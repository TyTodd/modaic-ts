import type { Signature } from "../signatures/signature";
import {
  type JsonSchema,
  fieldDesc,
  pydanticTitle,
  serializeField,
  sortSchema,
} from "./zod_schema";

/**
 * One field entry inside a serialized signature's `properties`.
 *
 * Always carries the dspy extras (`__dspy_field_type`, `desc`, `prefix`) and, for
 * non-`$ref` fields, a pydantic `title`. The remaining keys are whatever JSON-Schema
 * type fragment the field's Zod type produced (`type`, `items`, `enum`, `anyOf`,
 * `$ref`, `additionalProperties`, `prefixItems`, …). Key order in the emitted JSON is
 * alphabetical, matching the Python (pydantic) output.
 */
export interface ConfigField {
  __dspy_field_type: "input" | "output";
  desc?: string;
  prefix?: string;
  title?: string;
  type?: string;
  default?: unknown;
  $ref?: string;
  items?: JsonSchema;
  enum?: unknown[];
  const?: unknown;
  anyOf?: JsonSchema[];
  additionalProperties?: JsonSchema | boolean;
  prefixItems?: JsonSchema[];
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;
  [key: string]: unknown;
}

/**
 * The shape of `config.json` — the serialized signature schema.
 *
 * The `signature` object must be compatible with what the Python SDK produces via
 * `serializers.py::serialize_signature` (and reads back via `_deserialize_dspy_signatures`).
 * Concretely:
 *
 * ```json
 * {
 *   "model": null,
 *   "signature": {
 *     "$defs": { "Image": { "type": "dspy.Image" } },   // only when special types are used
 *     "description": "<instructions>",
 *     "properties": {
 *       "<field>": { "__dspy_field_type": "input"|"output", "desc": "...",
 *                    "prefix": "Field:", "title": "Field", "type": "string" }
 *     },
 *     "required": ["<input fields then output fields>"],
 *     "title": "<PascalCase repo name>",
 *     "type": "object"
 *   }
 * }
 * ```
 */
export interface ConfigJson {
  model: null;
  signature: {
    $defs?: Record<string, JsonSchema>;
    description: string;
    properties: Record<string, ConfigField>;
    required: string[];
    title: string;
    type: "object";
  };
}

/**
 * Build `config.json` from a Signature.
 *
 * Input fields are emitted before output fields (matching dspy). A field is in
 * `required` unless it has a Zod default or is `.optional()`. Special modaic types
 * (Image/Audio/Scale/Enum — see `signatures/types.ts`) serialize to the same JSON the
 * Python SDK uses, so the result round-trips into a `dspy.Signature` with no Python
 * changes.
 *
 * @param signature The Arbiter's signature.
 * @param title The top-level schema title (derived from the repo name).
 */
export function serializeSignatureToConfig(
  signature: Signature,
  title: string,
): ConfigJson {
  const defs: Record<string, JsonSchema> = {};
  const properties: Record<string, ConfigField> = {};
  const required: string[] = [];

  const addFields = (
    shape: Record<string, unknown>,
    direction: "input" | "output",
  ): void => {
    for (const [name, schema] of Object.entries(shape)) {
      const info = serializeField(schema, defs);

      const field: ConfigField = {
        __dspy_field_type: direction,
        desc: fieldDesc(info.meta, name),
        prefix: signature.prefixes[name],
        ...info.fragment,
      };
      // pydantic omits a field-level title when the field is a bare `$ref`.
      if (!info.isRef) {
        field.title = pydanticTitle(name);
      }
      if (info.hasDefault) {
        field.default = info.defaultValue;
      }

      properties[name] = field;
      if (!info.hasDefault && !info.optional) {
        required.push(name);
      }
    }
  };

  addFields(signature.input.shape, "input");
  addFields(signature.output.shape, "output");

  const signatureSchema: ConfigJson["signature"] = {
    description: signature.instructions ?? "",
    properties,
    required,
    title,
    type: "object",
  };
  if (Object.keys(defs).length > 0) {
    signatureSchema.$defs = defs;
  }

  return {
    model: null,
    signature: sortSchema(signatureSchema) as ConfigJson["signature"],
  };
}

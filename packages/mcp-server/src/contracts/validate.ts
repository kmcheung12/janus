/**
 * §17 runtime validation.
 *
 * The TypeScript types in ./types.ts are erased at build time and prove
 * nothing about a WebSocket frame or an MCP argument object. Everything that
 * crosses a boundary is validated here instead. Implementation must not
 * substitute casts for validation.
 *
 * Ajv is configured per §17: no coercion, no default insertion, no removal of
 * additional properties. Extra properties are rejected, never silently
 * stripped, and remote references are never resolved.
 */

import { readFileSync } from 'node:fs'
// Named import: ajv is CJS, and its default export is not constructable under
// Node16 ESM resolution.
import { Ajv } from 'ajv'
import type { ErrorObject, ValidateFunction } from 'ajv'
import type { ControlMessage } from './types.js'

export const SCHEMA_URI = 'urn:janus:webmcp-contracts:v1'

const schema = JSON.parse(
  readFileSync(new URL('./contracts.schema.json', import.meta.url), 'utf8'),
) as Record<string, unknown>

const ajv = new Ajv({
  strict: true,
  // `strictTypes` is an authoring lint about type annotations on conditional
  // subschemas, not a validation behaviour. The contract schema is a normative
  // artifact copied from the design spec; it uses allOf/if-then discrimination
  // without restating `type: "object"` in every branch. Rewriting it to satisfy
  // the lint would fork it from the spec, so the lint is off and the schema
  // stays byte-identical to the published contract.
  strictTypes: false,
  allErrors: true,
  // §17: reject rather than repair. Any of these would let a malformed or
  // hostile payload become a well-typed object that was never actually sent.
  coerceTypes: false,
  useDefaults: false,
  removeAdditional: false,
  // The contract is self-contained; a remote $ref would be a network fetch
  // during validation of untrusted input.
  loadSchema: () => Promise.reject(new Error('remote schema references are not permitted')),
})

ajv.addSchema(schema, SCHEMA_URI)

const compiled = new Map<string, ValidateFunction>()

/**
 * Get a validator for one named definition, e.g. `ControlMessage`,
 * `RecipeStep` or `SubmitToolDefinitionInput`.
 */
export function validatorFor(definition: string): ValidateFunction {
  const cached = compiled.get(definition)
  if (cached) return cached

  const ref = `${SCHEMA_URI}#/definitions/${definition}`
  const validate = ajv.getSchema(ref)
  if (!validate) throw new Error(`Unknown contract definition: ${definition}`)
  compiled.set(definition, validate)
  return validate
}

export interface ValidationFailure {
  valid: false
  /** Ajv error paths, formatted for logs and INVALID_INPUT messages. */
  errors: string[]
}

export type ValidationResult<T> = { valid: true; value: T } | ValidationFailure

function formatErrors(errors: ErrorObject[] | null | undefined): string[] {
  if (!errors?.length) return ['unknown validation failure']
  return errors.map((e) => `${e.instancePath || '/'} ${e.message ?? 'is invalid'}`.trim())
}

/** Validate an unknown value against a named definition. */
export function validateAs<T>(definition: string, value: unknown): ValidationResult<T> {
  const validate = validatorFor(definition)
  if (validate(value)) return { valid: true, value: value as T }
  return { valid: false, errors: formatErrors(validate.errors) }
}

/**
 * Validate a decoded control frame. Direction and milestone gating (§17) are
 * applied by the connection layer on top of this structural check.
 */
export function validateControlMessage(value: unknown): ValidationResult<ControlMessage> {
  return validateAs<ControlMessage>('ControlMessage', value)
}

/** The parsed schema document, for tests and for publishing authoring inputs. */
export function contractSchema(): Record<string, unknown> {
  return schema
}

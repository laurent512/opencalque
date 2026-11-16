import { documentJsonSchema, extensionJsonSchema, opsJsonSchema } from '@opencalque/core'

/** Where the schemas are published: the web build serves them there (`build-site.ts`), and SchemaStore points to them. */
export const SCHEMA_URL = 'https://opencalque.com/schema/'

/**
 * The JSON Schemas of documents, operations and extensions written as data, by file name, as
 * `opencalque schema` writes them into `schema/` and the site serves them: each says where it lives
 * and what it describes, so that an editor or a validator that meets one knows it again.
 */
export function publishedSchemas(): Record<string, unknown> {
  const named = (file: string, title: string, schema: Record<string, unknown>) => {
    const { $schema, ...rest } = schema
    return { $schema, $id: SCHEMA_URL + file, title, ...rest }
  }
  return {
    'document.schema.json': named('document.schema.json', 'OpenCalque drawing (.opencalque)', documentJsonSchema()),
    'ops.schema.json': named('ops.schema.json', 'OpenCalque operations (a list of edits to a drawing)', opsJsonSchema()),
    'extension.schema.json': named('extension.schema.json', 'OpenCalque extension written as data', extensionJsonSchema()),
  }
}

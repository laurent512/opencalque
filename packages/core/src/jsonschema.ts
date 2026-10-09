import * as z from 'zod'
import { OpSchema } from './ops'
import { DocumentSchema, NodeSchema } from './schema'

/** JSON Schemas generated from the Zod definitions, for tools that validate or describe the format. */
export const documentJsonSchema = () => z.toJSONSchema(DocumentSchema)
export const nodeJsonSchema = () => z.toJSONSchema(NodeSchema)
export const opsJsonSchema = () => z.toJSONSchema(z.array(OpSchema))

/** Physics worker entry. All logic lives in SimServer (testable in-process). */
import { SimServer } from './server.ts'
import type { Endpoint } from './protocol.ts'

export const server = new SimServer(self as unknown as Endpoint)

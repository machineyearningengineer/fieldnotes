/** Derive the machine-readable contract from the same schemas used at runtime. No credentials. */
import { openApiDocument } from "../packages/contracts/src/openapi.ts";
console.log(JSON.stringify(openApiDocument, null, 2));

# Deployment retirement — 4 November 2026

The interview has finished. The repository retains the implementation, local synthetic workflow, saved reports and standalone interview guide.

- Vercel project `fieldnotes-valyu` was deleted, including its deployments and project environment variables.
- Google accepted deletion of isolated project `fieldnotes-valyu-20261102`; its observed lifecycle is `DELETE_REQUESTED`. Final removal is asynchronous. Before deletion, 700 Firestore documents were exported to a private local backup; that backup is excluded from publication. Historical or delayed charges may still arrive.
- The separate ChatGPT Sites interview guide remains available; it is static reading material and makes no research provider calls.

The public edition starts with a clean source snapshot. Employer correspondence, the employer brief, private review notes, local credentials, scratch state and the original Git history remain private. Long retrieved excerpts are omitted from public example JSON; original evidence remains local. The existing licence is retained; publication does not grant an open-source licence.

## Private data archive

The full archive contains task inputs, owner identifiers, submission/idempotency records, raw retrieval results, generated drafts, evidence-check artifacts and provider receipts. It is not a sanitised public dataset. Keep it out of Git, including Git LFS and release assets.

The private local JSON export contains 700 documents. It is a custom Firestore REST export, not a native Firestore managed backup. Restoration has not been tested. Preserve an encrypted second copy in private backup storage, with a manifest and checksum, before treating it as a durable archive. Selected reports and redacted examples in this repository are the public evidence set.

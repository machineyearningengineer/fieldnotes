import { readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";

export async function localImport(directory) {
  let text;
  try {
    text = await readFile(path.join(directory, "current.json"), "utf8");
  } catch (cause) {
    if (cause.code !== "ENOENT") throw cause;
    return (
      (await readdir(directory)).find((name) => name.endsWith(".overall_export_metadata")) ?? ""
    );
  }
  const manifest = JSON.parse(text);
  if (
    typeof manifest.metadata !== "string" ||
    !/^snapshot-\d+\/snapshot-\d+\.overall_export_metadata$/.test(manifest.metadata)
  )
    throw new Error(
      "Invalid local snapshot manifest; the emulator was not started with an empty database.",
    );
  if (!(await stat(path.join(directory, manifest.metadata))).isFile())
    throw new Error("Local snapshot metadata is missing.");
  return manifest.metadata;
}

export async function exportLocalSnapshot(host, directory) {
  if (!/^(127\.0\.0\.1|localhost):\d+$/.test(host))
    throw new Error("Only a local emulator can be exported.");
  const name = `snapshot-${Date.now()}`;
  const response = await fetch(`http://${host}/emulator/v1/projects/valyu-research-local:export`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      database: "projects/valyu-research-local/databases/(default)",
      export_directory: "/data",
      export_name: name,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok)
    throw new Error(`Emulator export failed (${response.status}); its container was left running.`);
  const metadata = `${name}/${name}.overall_export_metadata`;
  await stat(path.join(directory, metadata));
  const temporary = path.join(directory, "current.json.tmp");
  await writeFile(temporary, JSON.stringify({ metadata }, null, 2));
  await rename(temporary, path.join(directory, "current.json"));
  return metadata;
}

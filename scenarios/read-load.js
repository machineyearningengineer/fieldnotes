// Small local read smoke. It never creates a task or contacts a paid provider.
import http from "k6/http";
import { check, sleep } from "k6";
const base = __ENV.BASE_URL;
const task = __ENV.TASK_ID;
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(base ?? "") || !/^[a-f0-9-]{36}$/.test(task ?? ""))
  throw new Error("Set local BASE_URL and a saved TASK_ID.");
export const options = {
  vus: 5,
  iterations: 50,
  thresholds: { checks: ["rate==1"], http_req_failed: ["rate==0"] },
};
let etag;
export default function () {
  const result = http.get(`${base}/tasks/${task}`, {
    headers: etag ? { "If-None-Match": etag } : {},
    tags: { name: "saved-task-read" },
  });
  check(result, {
    "saved snapshot or unchanged": (response) => response.status === 200 || response.status === 304,
  });
  if (result.headers.Etag) etag = result.headers.Etag;
  sleep(0.05);
}

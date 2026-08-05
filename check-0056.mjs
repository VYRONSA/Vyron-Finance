import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
function loadEnv() {
  const content = fs.readFileSync(".env.local", "utf8");
  const env = {};
  for (const line of content.split(/\r?\n/)) {
    if (!line.includes("=") || line.trim().startsWith("#")) continue;
    const i = line.indexOf("=");
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    env[line.slice(0, i).trim()] = v;
  }
  return env;
}
const env = loadEnv();
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const { error } = await admin.rpc("bootstrap_company_owner_role", { target_company_id: "00000000-0000-0000-0000-000000000000", performed_by: "check" });
console.log(error ? (error.message.includes("Could not find the function") ? "NOT APPLIED YET" : "APPLIED: " + error.message) : "APPLIED (unexpectedly succeeded)");

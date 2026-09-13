import test from "node:test"; import assert from "node:assert/strict"; import { readFile } from "node:fs/promises";
const source=await readFile(new URL("./supabase.js",import.meta.url),"utf8");
test("server auth clients disable persistence and automatic refresh",()=>{assert.match(source,/function createServerAuthClient/);assert.match(source,/autoRefreshToken: false, persistSession: false/);assert.match(source,/return createClient\(supabaseUrl, supabaseAnonKey, options\)/)});

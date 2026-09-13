import test from "node:test"; import assert from "node:assert/strict"; import { readFile } from "node:fs/promises";
const files=await Promise.all(["feedback-index.ejs","feedback-detail.ejs","login.ejs"].map(f=>readFile(new URL(`../../views/admin/${f}`,import.meta.url),"utf8")));const all=files.join("\n");
test("admin forms are CSRF protected and labeled",()=>{assert.equal((all.match(/name="_csrf"/g)||[]).length,2);assert.match(all,/label for="status"/);assert.match(all,/aria-label="Filter submissions"/)});
test("submission values use escaped EJS interpolation",()=>{assert.doesNotMatch(all,/<%-\s*(item|submission)/);for(const f of ["contact_name","contact_email","subject","message"])assert.match(all,new RegExp(`(item|submission)\\.${f}`))});

import test from "node:test"; import assert from "node:assert/strict";
import { filterStatuses, isAdminUser, mergeAssignableAdmins, normalizeFilter, normalizeUpdate } from "./adminUtils.js";
test("only immutable app metadata grants admin",()=>{assert.equal(isAdminUser({app_metadata:{role:"admin"}}),true);assert.equal(isAdminUser({user_metadata:{role:"admin"}}),false)});
test("filters and updates are allowlisted",()=>{assert.equal(normalizeFilter("bad"),"unresolved");assert.deepEqual(filterStatuses("unresolved"),["new","in_progress"]);assert.equal(normalizeUpdate({status:"done",assigneeId:""}).valid,true);assert.equal(normalizeUpdate({status:"bad"}).valid,false)});
test("inactive current assignee remains a labeled choice",()=>{const s={assignee_id:"123e4567-e89b-42d3-a456-426614174000",assignee:{display_name:"Pat"}};assert.match(mergeAssignableAdmins([],s)[0].display_name,/inactive/)});

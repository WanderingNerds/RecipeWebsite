import test from "node:test";import assert from "node:assert/strict";process.env.SUPABASE_URL||="https://example.supabase.co";process.env.SUPABASE_ANON_KEY||="test";const {createRequireAdmin}=await import("./authMiddleware.js");
const res=()=>({locals:{},out:{},status(c){this.out.status=c;return this},redirect(...v){this.out.redirect=v;return this},cookie(){return this}});
test("admin middleware denies anonymous and user_metadata admins",async()=>{let next=false;let r=res();await createRequireAdmin()({cookies:{},flash(){}},r,()=>next=true);assert.equal(next,false);assert.deepEqual(r.out.redirect,["/admin/login"]);r=res();const m=createRequireAdmin({createAuthClient:()=>({auth:{getUser:async()=>({data:{user:{user_metadata:{role:"admin"}}},error:null})}})});await m({cookies:{"sb-access-token":"a"},flash(){}},r,()=>next=true);assert.equal(r.out.status,403)});
test("refresh rotates tokens and rechecks admin claim",async()=>{const m=createRequireAdmin({createAuthClient:()=>({auth:{getUser:async()=>({data:{user:null},error:{} }),refreshSession:async()=>({data:{user:{app_metadata:{role:"admin"}},session:{access_token:"new",refresh_token:"rotated"}},error:null})}})});const q={cookies:{"sb-access-token":"old","sb-refresh-token":"r"},flash(){}};const r=res();let next=false;await m(q,r,()=>next=true);assert.equal(next,true);assert.equal(q.accessToken,"new")});

// REW-86: requireApiAuth was extracted here from likeRoutes.js /
// mealPlanApiRoutes.js / cookbookApiRoutes.js, which each held a verbatim
// copy. These lock in the JSON contract those three API surfaces depend on.
const {createRequireApiAuth,requireApiAuth}=await import("./authMiddleware.js");
const apiRes=()=>({statusCode:200,body:null,status(c){this.statusCode=c;return this},json(b){this.body=b;return this}});
test("requireApiAuth answers auth failures with JSON, never a redirect",async()=>{
  let next=false;let r=apiRes();
  await requireApiAuth({cookies:{}},r,()=>next=true);
  assert.equal(next,false);assert.equal(r.statusCode,401);assert.deepEqual(r.body,{error:"Authentication required"});
  r=apiRes();
  const rejecting=createRequireApiAuth({authClient:{auth:{getUser:async()=>({data:{user:null},error:{message:"jwt expired"}})}}});
  await rejecting({cookies:{"sb-access-token":"stale"}},r,()=>next=true);
  assert.equal(next,false);assert.equal(r.statusCode,401);assert.deepEqual(r.body,{error:"Invalid or expired session"});
});
test("requireApiAuth attaches the verified user and the caller's own token",async()=>{
  const m=createRequireApiAuth({authClient:{auth:{getUser:async(t)=>({data:{user:{id:"user-1",token:t}},error:null})}}});
  const q={cookies:{"sb-access-token":"abc"}};const r=apiRes();let next=false;
  await m(q,r,()=>next=true);
  assert.equal(next,true);assert.equal(q.user.id,"user-1");assert.equal(q.accessToken,"abc");
  assert.equal(q.user.token,"abc","the caller's token, not a process-global session, is verified");
});
test("an unexpected auth failure is a JSON 500 logged under the caller's label",async()=>{
  const logged=[];const original=console.error;console.error=(...a)=>logged.push(a);
  const m=createRequireApiAuth({logLabel:"Cookbook API auth error:",authClient:{auth:{getUser:async()=>{throw new Error("network down")}}}});
  const r=apiRes();
  try{await m({cookies:{"sb-access-token":"abc"}},r,()=>{})}finally{console.error=original}
  assert.equal(r.statusCode,500);assert.deepEqual(r.body,{error:"Authentication error"});
  assert.equal(logged[0][0],"Cookbook API auth error:");
});
test("the middleware keeps the name route files assert on",()=>{
  assert.equal(requireApiAuth.name,"requireApiAuth");
  assert.equal(createRequireApiAuth({logLabel:"x"}).name,"requireApiAuth");
});

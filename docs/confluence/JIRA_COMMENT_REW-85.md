# Jira Comment for REW-85

## Implementation and documentation complete; browser and live-RLS acceptance pending

Private/Public visibility controls are implemented for manual creation, import review, cloning, and owner editing. Private maps to stored `draft`, Public maps to `published`, and malformed or omitted visibility fails closed to Private. Authenticated cloning creates a new Private recipe owned by the caller without copying photos or relationship/identity data.

**Review:** Approved after two loops; no blockers. Static security/RLS review approved.

**Automated validation:**
- Full Node suite: **271 total, 269 passed, 0 failed, 2 skipped** solely because this sandbox forbids local HTTP listeners.
- Focused reviewer suite: **24 passed, 0 failed**.
- Build, route syntax checks, and `git diff --check`: **passed**.

**Documentation:**
- [Updated implementation plan](https://wanderingnerds.atlassian.net/wiki/spaces/Recipe/pages/29491201/REW-85+Add+Private+Public+Recipe+Visibility+Controls+Implementation+Plan)
- [Release notes](https://wanderingnerds.atlassian.net/wiki/spaces/Recipe/pages/29622273/Release+REW-85+-+Add+Private+Public+Recipe+Visibility+Controls)

**Pending acceptance:** Authenticated/anonymous browser acceptance at desktop and mobile widths, including keyboard/focus behavior, and live Supabase RLS/grant verification were not executed and are not claimed as passed.

No database migration, backfill, dependency, environment variable, cache, or search-index change is required.

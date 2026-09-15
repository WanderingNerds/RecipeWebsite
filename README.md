# Recipe Website

A recipe website built with Node.js, Express, and Supabase Auth.

## Tech Stack

- **Backend**: Node.js + Express.js (ES modules)
- **Authentication**: Supabase Auth
- **Database**: Supabase (PostgreSQL)
- **Frontend**: EJS server-side rendering
- **Design System**: Potluck Brand Theme (CSS custom properties)
- **Typography**: Caprasimo (headings), Figtree (body)

## Getting Started

### Prerequisites

- Node.js 18+
- A Supabase account and project

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/WanderingNerds/RecipeWebsite.git
   cd RecipeWebsite
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Copy the environment file and configure it:
   ```bash
   cp .env.example .env
   ```

4. Update `.env` with your Supabase credentials:
   ```
   SUPABASE_URL=https://your-project.supabase.co
   SUPABASE_ANON_KEY=your-supabase-anon-key
   SESSION_SECRET=your-session-secret
   APP_URL=https://your-production-domain.com  # Required for production
   RESEND_API_KEY=re_your-resend-api-key       # Required for assignment notifications
   ASSIGNMENT_EMAIL_FROM=Potluck <verified-sender@example.com>
   ```

   Note: `APP_URL` is required for email confirmation links, admin assignment links, the copyable cookbook share link (`<APP_URL>/c/<id>`, REW-19), and — as of REW-69 — the copyable meal plan share link (`<APP_URL>/m/<id>`) to work correctly in production. In development, it defaults to `http://localhost:3000`. `ASSIGNMENT_EMAIL_FROM` must use a sender accepted by the configured Resend account.

   No new environment variables were introduced by REW-19.

5. Start the development server:
   ```bash
   npm run dev
   ```

6. Visit `http://localhost:3000`

## Supabase Setup

1. Create a project at [supabase.com](https://supabase.com)
2. Go to **Settings > API** to get your:
   - Project URL (`SUPABASE_URL`)
   - Anon/Public key (`SUPABASE_ANON_KEY`)
3. Configure authentication redirect URLs in **Authentication > URL Configuration**:
   - **Site URL**: Set to your production URL (e.g., `https://your-domain.com`)
   - **Redirect URLs**: Add your callback and password-reset URLs:
     - Production: `https://your-domain.com/auth/callback`, `https://your-domain.com/auth/reset-password`
     - Development: `http://localhost:3000/auth/callback`, `http://localhost:3000/auth/reset-password`
4. **Reset Password email template (required — REW-57):** In **Authentication > Email Templates > Reset Password**, paste the template from `docs/email-templates/reset-password.html`. It links to `{{ .SiteURL }}/auth/reset-password?token_hash={{ .TokenHash }}&type=recovery`, **not** the default `{{ .ConfirmationURL }}`. The default variable points at Supabase's own verify endpoint, which delivers the session as a URL hash fragment; if the computed `redirect_to` isn't on the allow-list above, Supabase falls back further to the Site URL — i.e. the reset link opens the Home page instead of the reset-password form. See `docs/email-templates/README.md` for the full variable reference.
5. **`APP_URL` must be set in Vercel (required — REW-57):** Set the `APP_URL` environment variable for the **Production** environment in Vercel Project Settings to the canonical production origin (scheme + host, no trailing slash). Without it, password-reset and email-confirmation links generated in production fall back to `http://localhost:3000`, which can never be reached by anyone but the developer and isn't on the Supabase Redirect URL allow-list. As of REW-19 the same value is also the origin of every cookbook share link an owner copies, so a wrong or missing `APP_URL` produces share links that don't work for the people they're sent to.
6. Authentication is handled automatically by Supabase Auth

### Administrator feedback setup (REW-71, REW-78)

Apply migrations 014, 015, and 016 in order. Administrator access is still provisioned out of band through the Supabase Auth user's trusted `app_metadata.role`; migration 016 only backfills Andrew and Victoria's assignment profiles from their exact emails after that role exists. The fixed assignment roster recognizes the explicit stored names `Andrew` or `Andrew Carroll`, and `Victoria` or `Victoria Johnson`; it always renders the shorter product labels. Refresh or re-authenticate so the issued token carries the claim. Assignment notification email uses the Resend HTTPS API and requires `RESEND_API_KEY`, `ASSIGNMENT_EMAIL_FROM`, and the canonical `APP_URL`. Never expose a service-role or mail-provider key in the application. See [Admin Help & Feedback](docs/api/admin-feedback.md) and [database setup](database/README.md).

## Project Structure

```
recipe-website/
├── src/
│   ├── config/
│   │   ├── supabase.js         # Supabase client
│   │   └── functionLimits.js   # Serverless invocation budget: mirrored Vercel maxDuration, derived OCR timeout (REW-93)
│   ├── middleware/
│   │   ├── authMiddleware.js   # Auth middleware; also the shared createRequireApiAuth JSON-401 factory used by every /api route file (REW-86)
│   │   └── errorHandler.js     # Error handling
│   ├── routes/
│   │   ├── index.js            # Main routes
│   │   ├── authRoutes.js       # Auth routes
│   │   ├── recipeRoutes.js     # Recipe CRUD routes
│   │   ├── categoryRoutes.js   # Category API routes
│   │   ├── tagRoutes.js        # Tag API routes
│   │   ├── likeRoutes.js       # Recipe favorite/like API routes (REW-21)
│   │   ├── publicRoutes.js     # Unauthenticated pages: /browse, /search, /r/:id, /c/:id, /m/:id (anon-key client only)
│   │   ├── cookbookRoutes.js   # Cookbook CRUD + recipe membership + visibility toggle (REW-62, REW-19)
│   │   ├── mealPlanRoutes.js   # Meal plan CRUD + bulk-add page routes + visibility toggle (REW-63, REW-69)
│   │   ├── mealPlanApiRoutes.js # Meal plan JSON API backing the "Add to Meal Plan" modal (REW-63)
│   │   ├── cookbookApiRoutes.js # Cookbook JSON API backing the "+ Cookbook" card modal (REW-86)
│   │   ├── helpFeedbackRoutes.js # Authenticated feedback routes (REW-70)
│   │   ├── adminAuthRoutes.js   # Isolated administrator sign-in/logout (REW-71)
│   │   └── adminFeedbackRoutes.js # Admin-only feedback queue and workflow (REW-71)
│   ├── utils/
│   │   ├── imageUtils.js       # Image processing utilities
│   │   ├── ingredientParser.js # Ingredient parsing
│   │   ├── ingredientScaler.js # Recipe scaling logic
│   │   ├── cookbookUtils.js    # Cookbook title validation, recipe-id normalization (REW-62), fail-closed visibility normalizer (REW-19)
│   │   ├── mealPlanUtils.js    # Meal plan title + date-range validation (REW-63), fail-closed visibility normalizer (REW-69)
│   │   ├── helpFeedbackUtils.js # Feedback validation (REW-70)
│   │   └── adminUtils.js        # Admin claim and workflow validation (REW-71)
│   └── app.js                  # Express app setup
├── views/
│   ├── layouts/main.ejs        # Main layout
│   ├── partials/navbar.ejs     # Navigation bar
│   ├── partials/meal-plan-modal.ejs # Shared "Add to Meal Plan" modal (REW-63)
│   ├── partials/cookbook-modal.ejs  # Shared "Add to Cookbook" modal (REW-86)
│   ├── partials/recipe-summary-card.ejs # Shared recipe card for My Recipes and Browse (REW-59, REW-86)
│   ├── auth/                   # Login/Register pages
│   ├── recipes/                # Recipe views (index, new, edit, view)
│   ├── cookbooks/               # Cookbook views (index, new, view, edit, add-recipes; public-view for shared cookbooks) (REW-62, REW-19)
│   ├── meal-plans/              # Meal plan views (index, new, view, edit, add-recipes, grocery-list; public-view for shared plans) (REW-63, REW-26, REW-69)
│   ├── home.ejs                # Home page
│   └── dashboard.ejs           # Protected dashboard
├── public/
│   ├── css/styles.css          # Potluck design system and styles
│   └── js/
│       ├── main.js             # Client-side JavaScript
│       ├── nav.js              # Mobile hamburger nav toggle (REW-50)
│       ├── likes.js            # Favorite/like button optimistic UI (REW-21; also drives My Recipes cards, REW-55)
│       ├── meal-plans.js       # "Add to Meal Plan" modal fetch/toggle logic (REW-63)
│       ├── cookbooks.js        # "+ Cookbook" modal fetch/toggle logic (REW-86)
│       ├── cookbook-share.js   # Copy-link button on a Public cookbook's share panel (REW-19)
│       ├── meal-plan-share.js  # Copy-link button on a Public meal plan's share panel (REW-69)
│       ├── recipe-form.js      # Recipe form handling
│       └── tags-input.js       # Tag input with autocomplete
├── database/
│   └── migrations/             # SQL migration files
├── server.js                   # Entry point
└── package.json
```

## Features

### Dashboard Quick Actions (REW-65)

The authenticated dashboard is the primary navigation surface for recipe organization and support. It provides five consistent, fully clickable cards: **My Recipes**, **My Cookbooks**, **My Favorites**, **My Meal Plans**, and **Help & Feedback**. The four organization links remain omitted from the authenticated navbar. Cards use Potluck tokens, responsive layout, hover, and visible keyboard-focus states.

### Help & Feedback (REW-70)

Authenticated users can submit support requests from the fifth Dashboard Quick Action. `/help-feedback` validates category, subject, message, and editable account-derived contact snapshots, then redirects after a successful authenticated Supabase insert. Apply migration 014 before deployment; live database/RLS/storage and browser acceptance remain pending. See [Help & Feedback](docs/api/help-feedback.md).

### Admin Help & Feedback Management (REW-71)

Administrators sign in separately at `/admin/login` and manage submissions at `/admin/feedback`. The newest-first queue supports All, Unresolved, and Done filters. Ticket detail shows escaped submission data and lets an administrator update status (`new`, `in_progress`, `done`) or assign exactly Andrew, Victoria, or Unassigned. A new or changed named assignment sends the new assignee a direct ticket link after persistence; unassignment and unchanged assignment do not send mail. If delivery fails, the saved assignment remains authoritative and the administrator sees a separate warning.

Express validates the Supabase user's trusted `app_metadata.role = "admin"`; migration 015 independently enforces admin-only reads and workflow updates through RLS, column-level UPDATE privileges, and OLD/NEW-aware assignment validation. Auth operations use fresh non-persisting Supabase clients, while data access remains tied to the verified request token. Global CSRF protection covers non-multipart unsafe requests; multipart routes validate after Multer parsing. Logout is POST-only.

Local/static QA passes 185/185 with zero skips, including listener-backed CSRF/auth/logout/fetch/multipart and migration contracts. Live Supabase/browser acceptance is blocked until migrations 014/015 and safe admin/regular fixtures are available. See [Admin Help & Feedback](docs/api/admin-feedback.md) and the [QA record](docs/qa/rew-71-admin-feedback-management.md).

### Recipe Management
- Create, view, edit, and delete recipes
- Rich recipe metadata (prep time, cook time, servings, difficulty)
- Image upload with automatic thumbnail generation
- **Recipe Photo Upload Limit (REW-94)** — *implemented and code-reviewed on branch `REW-94-recipe-image-upload-limit-vercel-cap`; not QA-verified and not yet merged.* The recipe photo cap is **4MB** (was 5MB), deliberately below Vercel's hard 4.5MB request-body cap. At 5MB, photos between roughly 4.5MB and 5MB could never succeed in production — the platform rejected the request before any app code ran, and the user got an opaque Vercel error page. Both recipe forms now state "Maximum file size: 4MB" (they previously stated no size at all), the browser blocks an oversize file before it is uploaded, and a rejected upload returns to the form with a readable message instead of the generic "Something went wrong" page. See [Recipe Photo Upload](docs/api/recipe-photo-upload.md).
- Draft/Published status workflow
- **Author Defaults to Account Name (REW-46)**: When creating a recipe manually or via import, the Author field is pre-filled with the logged-in user's account display name (their registered name, or email if no name is set) and this default is enforced server-side even if the field is submitted blank. Author remains fully editable, so a recipe can still be attributed to someone else (e.g. "Grandma's recipe").
- **Required Prep Time / Total Time (REW-52)**: The manual "New Recipe" and "Edit Recipe" forms require both Prep Time and Total Time before a recipe can be saved (draft or published), with inline validation that highlights the missing field(s) and clears as soon as a value is entered; enforced server-side too. "Total Time" is a display-only relabel of the existing Cook Time field — no new database column was added. As of REW-77, Import Recipe also requires the same underlying Cook Time value for draft and publish saves, while imported Prep Time remains optional; see [Recipe Import Save API](docs/api/recipe-import-save.md).
- **Private/Public Recipe Visibility (REW-85)**: Manual creation, import review, cloning, and owner editing use a single Private/Public choice and one save action. Private is the default and maps to stored `draft`; Public maps to `published`. Missing or invalid input fails closed to Private. Authenticated users can clone any recipe visible to them into a new Private recipe they own; photos and relationship records are not copied. See [Recipe Visibility](docs/api/recipe-visibility.md).

### Recipe Import (REW-12, REW-43, REW-93)

Authenticated users can import a recipe from a single JSON-LD, PDF, or image file at `/recipes/import`; PDFs are text-extracted and images are read with OCR, then the parsed result is shown for review before saving.

Current limits (raised in REW-43 after QA reported the previous ceilings were too low):

- **25 imports per 15 minutes per IP** (was 5) on `POST /recipes/import/parse`.
- **4MB per file** (was 2MB) — enough for phone photos of a recipe page and scanned PDFs, and deliberately under Vercel's hard 4.5MB request-body cap so oversize uploads get a clean JSON error instead of a platform error page.
- **300 general requests per 15 minutes per IP** in production (was 100), sized so one multi-recipe import session fits in a single window.
- **8 seconds of OCR per import** (REW-93). `src/config/functionLimits.js` mirrors `vercel.json`'s 10-second `maxDuration` and subtracts a 2-second reserve for parsing, decoding, and the response, so the app's own timeout always fires before the platform kills the request. A test reads the real `vercel.json` and fails if the two values drift apart. Note the behaviour change: an image that previously ran to the 10-second platform deadline now fails at 8 seconds — but with a readable "Image processing timed out" message instead of an opaque platform error page.

Every rejection from the parse endpoint now returns JSON — `429` for the rate limit, `413` for an oversize file, `400` for an unsupported or malformed upload or an OCR timeout — so the import screen shows the real reason instead of a generic parse failure. A gateway-level timeout that still slips through (most likely a slow PDF; the PDF path has no timeout of its own yet, tracked in REW-97) shows "The import took too long. Try a smaller file." See [Recipe Import Limits & Error Contract](docs/api/recipe-import-limits.md) and [OCR/PDF Text Parsing](docs/api/recipe-import-ocr-parsing.md).

**Image normalization before OCR (REW-95)** — *implemented and code-reviewed on branch `REW-95-ocr-decoded-pixel-cap`; not QA-verified and not yet merged.* Imported images are now run through `sharp` before OCR: decoded input is capped at **40,000,000 pixels**, EXIF rotation is applied, the image is downscaled to fit 2000x2000 (never enlarged), converted to single-channel grayscale, and re-encoded as PNG. The 4MB upload limit only bounds *encoded* bytes, so without this a small, highly compressible PNG could still decompress to a multi-gigabyte bitmap and exhaust the function's memory. Rejected images return the same generic `400` as any other image failure, so nothing about the response changes for legitimate users. Known tradeoff: very dense, high-resolution recipe photos are downscaled to 2000px, which may cost some OCR accuracy on small type. See [OCR/PDF Text Parsing](docs/api/recipe-import-ocr-parsing.md#image-normalization-before-ocr-rew-95).

### Browse Recipe Cards (REW-59)

Browse and My Recipes share their core card layout: thumbnail, title/status, author, all categories, tags, separate prep/cook times, servings, difficulty, and creation date. Browse keeps public recipe links and Meal Plan controls; My Recipes keeps favorite, filter, View/Edit/Delete controls. Browse badges are informational. Long titles and badges wrap within cards.

This local implementation requires migration `013_public_recipe_card_metadata.sql` before release. Staging RLS verification and live end-to-end acceptance are pending; see [Browse route documentation](docs/api/browse-recipes.md) and the [QA report](docs/qa/rew-59-browse-recipe-cards.md). No new environment variables are required.

### My Recipes Recipe Cards (REW-86)

*Implemented and code-reviewed on branch `REW-86-standardize-my-recipes-card`; **QA was not run**, and the branch is not merged.*

Every card on **My Recipes** (`/recipes`) now carries the same content and the same set of actions: a clickable title, the favorite heart, an owner-only **Private/Public** control, author, categories, tags, `Prep Time:` / `Cook Time:` / `Servings:` / `Difficulty:` metadata, `+ Meal Plan`, `+ Cookbook`, Share, Edit, and Delete. Browse cards share the same template but gain none of the owner controls.

- **Change visibility from the card.** A labelled control replaces the old read-only status pill: it shows the current state and a single "Make Public" / "Make Private" button. It is a normal form submission followed by a redirect, so the whole card re-renders — which is what keeps the favorite heart correct, since a Private recipe can't be favorited. Toggling while a category or tag filter is active returns to the same filtered list. Invalid or tampered input always resolves to Private, never Public.
- **Add to a cookbook without leaving the page.** `+ Cookbook` opens a modal listing the user's cookbooks with add/remove toggles and an inline "+ New cookbook" quick-create, mirroring the existing "Add to Meal Plan" modal. Adding the same recipe twice is a no-op rather than an error. Only the user's own recipes and own cookbooks are in play.
- **Share is a placeholder, on purpose.** The button is visible but inert — no link, no request, no URL exposed. Real sharing behavior is [REW-18](https://wanderingnerds.atlassian.net/browse/REW-18). It deliberately does not link to `/r/:id`, which would be misleading for a Private recipe.
- **No database migration.** Every action touches only the signed-in user's own rows and is already covered by existing RLS.

See [My Recipes Recipe Card](docs/api/my-recipes-card.md) for the route contracts and `docs/RELEASE_NOTES_REW-86.md` for what was and wasn't verified. Known overlap: REW-59 is editing the same shared card partial on its own branch, so expect a merge conflict there and a probable duplicate cookbook API/modal.

### Favorites / Recipe Likes (REW-21, REW-55)
- **Heart-Toggle Favoriting**: Authenticated users can like/unlike any **published** recipe from a heart-shaped `.like-btn` control with optimistic UI (instant toggle, reverts on a failed request) and an "Undo" toast after unliking (`public/js/likes.js`, backed by `POST`/`DELETE /api/likes/:recipeId`).
- **Liked Recipes Page**: A dedicated `/recipes/liked` page lists everything the logged-in user has favorited.
- **Favorite Action on My Recipes (REW-55)**: The heart control now also appears directly on each recipe card under **My Recipes** (`/recipes`), not just the single-recipe view — so a user can favorite/unfavorite without opening the recipe. **Draft** recipe cards show the same heart in a disabled/muted state (not clickable) because the underlying `/api/likes/:recipeId` endpoint only allows liking `published` recipes; publishing the recipe enables the control. Favorite state set from My Recipes is immediately reflected on the recipe's detail page and on `/recipes/liked`, since all three surfaces read/write the same `recipe_likes` table.

### Cookbooks (REW-62)
- **Create, Rename, and Delete Cookbooks**: Authenticated users can organize their own recipes into named, private collections ("cookbooks") from a dedicated "My Cookbooks" area (linked from the navbar). A cookbook holds any number of recipes, and the same recipe can belong to multiple cookbooks at once.
- **Add/Remove Recipes**: From a cookbook's detail page, a checklist picker (`/cookbooks/:id/add-recipes`) lets a user bulk-add any of their own recipes — draft or published — into the cookbook. A "Save to Cookbook(s)" widget on the recipe detail page offers the same add/remove actions for one recipe at a time, without leaving the recipe page.
- **Recipes Are Never Deleted by Cookbook Actions**: Deleting a cookbook removes only the cookbook and its membership records — the recipes in it are untouched and remain in "My Recipes" and any other cookbooks. Removing a recipe from a cookbook works the same way in reverse.
- **Private by Default**: Cookbooks are visible only to their owner, enforced at the database level (Row Level Security) — there is no policy allowing another user to read a Private cookbook they don't own, so a direct URL/ID guess can't expose it.
- See [Cookbooks API](docs/api/cookbooks.md) for the full endpoint list and `database/README.md` for the `cookbooks`/`cookbook_recipes` schema.

### Cookbook Sharing (REW-19)
- **One Private/Public Choice per Cookbook**: From a cookbook's detail page, the owner can make it Public and make it Private again, as many times as they like. Private stays the default for new cookbooks, and every cookbook that existed before this feature is Private.
- **Shareable Link**: A Public cookbook is readable by anyone at `/c/<cookbook-id>`, signed in or not. The cookbook's own ID is the share link — the same approach already used for public recipes at `/r/<recipe-id>`, so there is no token to manage. The detail page shows the full URL in a copyable field with a Copy button.
- **Instant Revocation**: Making a cookbook Private again breaks the link immediately. Visibility is re-read from the database on every request and never cached, so a previously-working link returns a plain "not found" on the very next load.
- **Discoverable in Search**: Public cookbooks appear as a small secondary "Cookbooks" section on `/search`, beneath the recipe results. Private cookbooks never appear there for anyone, including their owner searching the exact title.
- **Draft Recipes Never Leak**: A cookbook can contain the owner's Private recipes. A shared cookbook shows **only** Public recipes — to visitors, to other signed-in users, and to the owner opening their own share link. The public page is served entirely through the anonymous database key, so drafts are invisible at the database layer rather than filtered out in application code. A Public cookbook whose recipes are all Private simply renders as empty, with no hint that anything is hidden.
- **Read-Only for Everyone**: The shared page has no edit, rename, delete, add-recipe, or remove-recipe control for anyone, including the owner. A Private cookbook, a nonexistent one, and a malformed link all return the same 404, so a Private cookbook's existence can't be probed.
- **Nothing Else Changes**: Sharing a cookbook never changes any recipe's own Private/Public status, never alters cookbook membership, and never affects the rule that deleting a cookbook leaves its recipes intact.
- **Not included**: saving or cloning someone else's whole shared cookbook into your own account — tracked as follow-up REW-91. Recipe-level cloning (REW-84) already works, so a visitor can open any recipe in a shared cookbook and use Add Recipe today.
- Requires migration `019_add_cookbook_sharing.sql`. **This feature is code-reviewed but has not been QA-verified against a live Supabase** — see `docs/RELEASE_NOTES_REW-19.md` for the list of unverified acceptance criteria.

### Meal Plans (REW-63)
- **Create, Rename/Re-date, and Delete Meal Plans**: Authenticated users can organize recipes for a defined scheduled period (a required start/end date range) from a dedicated "My Meal Plans" area (linked from the navbar). A meal plan holds any number of recipes, and the same recipe can belong to multiple meal plans — and independently, to multiple cookbooks, since the two features don't interact.
- **Add to Meal Plan from Cards and Recipe Pages**: An "Add to Meal Plan" button on recipe cards (`/browse`, `/search`, `/recipes/liked`) and on both the owner's recipe page and the public recipe page opens a shared modal (no full page reload) listing the user's meal plans with add/remove toggles, plus an inline "+ New meal plan" quick-create option. A plan's own detail page also offers a bulk checklist picker (`/meal-plans/:id/add-recipes`) scoped to the owner's own recipes.
- **Own-or-Published Recipe Visibility (differs from Cookbooks)**: A user can add any of their own recipes (draft or published) to a meal plan, and can also add another user's *published* recipe — mirroring the same visibility rule already used by Recipe Likes. A user cannot add another user's draft/unpublished recipe; this is enforced at the database (RLS) level, not just in the UI.
- **Recipes Are Never Deleted by Meal Plan Actions**: Deleting a meal plan removes only the plan and its membership records — the recipes in it are untouched and remain in "My Recipes," any cookbooks, and any other meal plans. Removing a recipe from a plan works the same way in reverse.
- **Private by Default**: Meal plans are visible only to their owner, enforced at the database level (Row Level Security) — a direct URL/ID guess can't expose a Private plan. As of REW-69 an owner can opt an individual plan into a Public share link; see "Meal Plan Sharing" below.
- **Forward-compatible with Grocery Lists (REW-26, not built yet)**: The `meal_plan_recipes` junction table includes a nullable `planned_servings` column, unused by any current UI, so a future grocery-list feature can scale a recipe's ingredients per plan without another migration.
- See [Meal Plans API](docs/api/meal-plans.md) for the full endpoint list (including two non-blocking reviewer-flagged follow-ups) and `database/README.md` for the `meal_plans`/`meal_plan_recipes` schema.

### Meal Plan Sharing (REW-69)
- **One Private/Public Choice per Meal Plan**: From a plan's detail page, the owner can make it Public and make it Private again, as many times as they like. Private stays the default for new plans, and every meal plan that existed before this feature is Private.
- **Shareable Link**: A Public meal plan is readable by anyone at `/m/<meal-plan-id>`, signed in or not. The plan's own ID is the share link — the same approach already used for public recipes at `/r/<recipe-id>` and shared cookbooks at `/c/<cookbook-id>`, so there is no token to manage. The detail page shows the full URL in a copyable field with a Copy button.
- **What a Recipient Sees**: The plan's title, its scheduled start–end date range (formatted exactly as the owner sees it), and its Public recipes as read-only cards linking through to `/r/:id`. There is no per-day or meal-slot grid, because the meal plan feature does not have one yet — a plan's recipes are listed most-recently-added first.
- **Instant Revocation**: Making a plan Private again breaks the link immediately. Visibility is re-read from the database on every request and never cached, so a previously-working link returns a plain "not found" on the very next load.
- **Link-Only, Not Searchable**: Unlike Public cookbooks, Public meal plans never appear in site search. A meal plan is a time-boxed personal schedule, not browsable content, so it is shared by handing someone the link and nothing more.
- **Private Recipes Never Leak**: A plan can contain the owner's Private recipes. A shared plan shows **only** Public recipes — to visitors, to other signed-in users, and to the owner opening their own share link. The public page is served entirely through the anonymous database key, so Private recipes are invisible at the database layer rather than filtered out in application code. A Public plan whose recipes are all Private simply renders as empty, with no hint that anything is hidden.
- **Read-Only for Everyone**: The shared page has no edit, rename, re-date, delete, add-recipe, remove-recipe, or grocery-list control for anyone, including the owner. A Private plan, a nonexistent one, and a malformed link all return the same 404, so a Private plan's existence can't be probed.
- **Sharing One Plan Exposes No Others**: There is no listing surface that enumerates a user's plans, and `/m/:id` for any Private plan returns the same 404 as a nonexistent one.
- **Nothing Else Changes**: Sharing a plan never changes any recipe's own Private/Public status, never alters plan membership or dates, and never affects the rule that deleting a meal plan leaves its recipes intact. Making a plan Public grants read access to `/m/:id` only — `/meal-plans/:id`, `/edit`, `/add-recipes`, `/grocery-list`, and every `/api/meal-plans/*` route stay owner-only.
- **Not included**: saving or copying someone else's shared plan into your own account, a grocery list on the shared page, per-user or email-based sharing, and search discoverability. Each is a possible follow-up ticket.
- Requires migration `020_add_meal_plan_sharing.sql`. **This feature is code-reviewed but has not been QA-verified against a live Supabase** — see `docs/RELEASE_NOTES_REW-69.md` for the list of unverified acceptance criteria.

### Instant Recipe Scaling (REW-11)
- **Real-time Scaling**: Adjust recipe servings without page reloads
- **Interactive Controls**: Plus/minus buttons for incremental adjustments
- **Direct Input**: Type a specific number of servings
- **Quick Scale Buttons**: One-click multipliers (0.5x, 1x, 2x, 3x) for recipes without parseable servings
- **Professional Accuracy**: Ingredients converted to grams for precise scaling
- **Practical Measurements**: Displays user-friendly amounts (e.g., "1 cup + 2 tbsp") as the primary amount, with the gram conversion shown as a secondary amount (REW-45); this is a fixed default with no user-facing toggle yet
- **Shareable URLs**: Scaled state reflected in URL for bookmarking and sharing

### Categories and Tagging (REW-11)
- **10 Pre-defined Categories**: Breakfast, Lunch, Dinner, Appetizers, Desserts, Beverages, Soups, Salads, Sides, Baking
- **Custom Tags**: Create and manage personal tags with autocomplete
- **Filtering**: Filter recipes by category and/or multiple tags
- **Visual Badges**: Clickable category/tag badges on recipe cards and detail views
- **Quick Navigation**: Click any badge to filter recipes instantly

### Authentication
- User registration with email/password
- Secure login with Supabase Auth
- Protected routes with middleware
- Automatic session management via cookies
- **Forgot Password / Account Recovery (REW-54)**: The Sign In page's "Forgot Password?" link opens a single centralized recovery page (`/auth/forgot-password`) where a user enters their email and chooses either "Send Password Reset Email" (new, built on Supabase Auth's `resetPasswordForEmail`) or "Resend Confirmation Email" (existing functionality, unchanged). The password reset link lands on `/auth/reset-password`, which requires `${APP_URL}/auth/reset-password` to be allow-listed in Supabase's dashboard alongside the existing `/auth/callback` entry.
- **Robust Reset-Link Handling (REW-57)**: `/auth/reset-password` never dead-ends on the Home page, even with a misconfigured email template or redirect-URL allow-list. It renders one of three states — the password form, an inline "invalid or expired" error with a "Request a new reset email" action, or a brief "checking" state — and a small client-side script (`public/js/auth-recovery.js`) plus a `POST /auth/reset-password/session` bridge endpoint recover the flow even if a reset link arrives with the session in a URL fragment instead of a query string. See `docs/api/email-confirmation.md` for details.
- **Sign-Up Field Labeled "Username" (REW-58)**: The registration form's first field now visibly reads "Username" (placeholder "Pick a username"), replacing the previous "Your name" label/placeholder. This is a copy-only fix — the underlying form field (`name`/`id="name"`) and its storage as Supabase `user_metadata.name` are unchanged, since that value is still reused elsewhere as the account's display name (navbar "Hello, {name}" greeting and recipe-author autofill).

### Potluck Brand Theme (REW-48)
- **Dark Olive Hero**: Hero section with `#4f5c3f` background and botanical decorations
- **Warm Backgrounds**: Oat milk/vanilla (`#faf5ea`) page backgrounds
- **Wavy Dividers**: SVG wave transitions between sections
- **Feature Cards**: Colored left borders with circular icons (Sage, Mist, Blush)
- **CSS Custom Properties**: Complete design token system for maintainability
- **Responsive Design**: Mobile-first with graceful degradation
- **Accessible Outline Buttons (REW-51)**: `.btn-outline` (View, Edit, Import Recipe, Cancel, Clear Filters, and 12 other buttons/links) now renders ink-on-light text (~12.9:1 contrast, ~8.6:1 on hover) instead of the near-invisible cream-on-cream text it previously inherited from a dark-background treatment. The one legitimate dark-background usage (navbar Logout) uses the dedicated `.btn-outline-light` class instead.
- **Single Home Page Search Bar (REW-53)**: The Home page hero no longer renders its own duplicate recipe search form. The header/navigation search bar (`.search-form-nav`, always visible in the navbar) is now the only search entry point on the Home page; the "Welcome to Potluck" heading, lede text, and Browse Recipes/Get Started/Add a Recipe buttons are unchanged.
- **Home Hero and Header Spacing (REW-56)**: The home page hero (`.hero`) no longer leaves excessive empty olive space above the curved wave divider (`min-height` reduced 38rem → 26rem, vertical padding reduced), with a proportional mobile padding tweak. The header nav links (`.navbar-nav`), the search input/button pairing (`.navbar .search-form-nav`), the user greeting/Logout pairing (`.navbar-user`), and the search/nav-menu column split (`.navbar-container`) all have larger gaps so the header no longer feels cramped. The `.search-form-nav` gap fix is scoped to `.navbar .search-form-nav` specifically (not the shared `.search-form` class), so the `/browse` and `/search` search bars are unaffected.

### Mobile Navigation & Responsive Layout (REW-50)
- **Hamburger Menu**: Persistent header (logo left, hamburger right) below the 768px breakpoint, replacing the old "nav links just disappear" behavior
- **Accessible Toggle**: `public/js/nav.js` wires `aria-expanded`/`aria-hidden`, closes the menu on link click, outside click/tap, repeat toggle, or Escape, and re-syncs state when crossing the 768px breakpoint (e.g. device rotation)
- **Single Mobile Breakpoint**: Consolidated two previously-conflicting mobile breakpoints in `styles.css` into one at 768px
- **No-Overflow Layouts**: Recipe/feature card grids and recipe forms collapse to a single column below 480px/640px respectively, replacing the fixed-width inline styles that used to overflow narrow viewports
- **44px Tap Targets**: Icon buttons, scale controls, like buttons, pagination links, and the hamburger toggle all meet a ~44x44px minimum tap target on mobile

## Scripts

- `npm start` - Start production server
- `npm run dev` - Start development server with hot reload

## Security

- Passwords handled securely by Supabase Auth
- HTTP-only secure cookies
- Helmet.js for security headers
- CORS configuration
- Rate limiting: 300 requests / 15 minutes per IP globally (production only), 25 recipe imports / 15 minutes per IP, 10 photo uploads / 15 minutes per IP, 60 recipe visibility changes / 15 minutes per IP (REW-86). Those limits are keyed by client IP, not by user account. The JSON API limiters (`/api/likes*`, `/api/meal-plans*`, and `/api/cookbooks*` at 30 mutations/minute — REW-86) are keyed per user, which is safe because those routes all sit behind auth. See the [rate limiting table](docs/api/README.md#rate-limiting).
- CSRF is enforced globally for unsafe non-multipart requests, but the global wrapper exempts *every* multipart POST rather than only the Multer routes that need it. Newer state-changing routes therefore re-apply `csrfProtection` explicitly at the route level, ahead of their rate limiter — `POST /recipes/:id/clone`, `POST /recipes/:id/visibility`, and every `/api/cookbooks*` mutation. The central fix is tracked as [REW-99](https://wanderingnerds.atlassian.net/browse/REW-99).
- Upload size caps are pinned below the deployment platform's own request-body cap. `src/config/functionLimits.js` holds `VERCEL_MAX_REQUEST_BODY_BYTES` (4.5MB), and both upload paths — recipe imports and recipe photos — are capped at 4MB with tests asserting they stay strictly under it (REW-43, REW-94). A limit above the platform cap is not a smaller problem than one below it: the platform answers first, so the app's own rate limiting, error handling, and messaging never run.
- Multer rejections on the recipe photo routes are answered by `handleRecipeImageUploadError` (REW-94, on branch — reviewed, not QA-verified, not merged) with a flash and a redirect to a path derived server-side. `req.params.id` is validated against a UUID pattern before it can reach the `Location` header, and the handler performs no state change, so running it ahead of route-level CSRF validation is safe. The middleware order `requireAuth` → rate limiter → Multer → error handler → `csrfProtection` is asserted by tests on both routes.
- Decompression-bomb protection on the recipe **import** path (REW-95, on branch — reviewed, not QA-verified, not merged): uploaded images are capped at 40,000,000 decoded pixels and downscaled to 2000x2000 before OCR. Upload size limits bound encoded bytes only, so this is a separate control, not a duplicate one — keep both. Errors are mapped to a single generic message so no library internals reach the HTTP response body. The recipe **photo** upload path (`src/utils/imageUtils.js`) still has no equivalent cap; tracked as REW-96.

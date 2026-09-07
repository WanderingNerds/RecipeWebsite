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
   ```

   Note: `APP_URL` is required for email confirmation links to work correctly in production. In development, it defaults to `http://localhost:3000`.

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
5. **`APP_URL` must be set in Vercel (required — REW-57):** Set the `APP_URL` environment variable for the **Production** environment in Vercel Project Settings to the canonical production origin (scheme + host, no trailing slash). Without it, password-reset and email-confirmation links generated in production fall back to `http://localhost:3000`, which can never be reached by anyone but the developer and isn't on the Supabase Redirect URL allow-list.
6. Authentication is handled automatically by Supabase Auth

## Project Structure

```
recipe-website/
├── src/
│   ├── config/
│   │   └── supabase.js         # Supabase client
│   ├── middleware/
│   │   ├── authMiddleware.js   # Auth middleware
│   │   └── errorHandler.js     # Error handling
│   ├── routes/
│   │   ├── index.js            # Main routes
│   │   ├── authRoutes.js       # Auth routes
│   │   ├── recipeRoutes.js     # Recipe CRUD routes
│   │   ├── categoryRoutes.js   # Category API routes
│   │   ├── tagRoutes.js        # Tag API routes
│   │   └── likeRoutes.js       # Recipe favorite/like API routes (REW-21)
│   ├── utils/
│   │   ├── imageUtils.js       # Image processing utilities
│   │   ├── ingredientParser.js # Ingredient parsing
│   │   └── ingredientScaler.js # Recipe scaling logic
│   └── app.js                  # Express app setup
├── views/
│   ├── layouts/main.ejs        # Main layout
│   ├── partials/navbar.ejs     # Navigation bar
│   ├── auth/                   # Login/Register pages
│   ├── recipes/                # Recipe views (index, new, edit, view)
│   ├── home.ejs                # Home page
│   └── dashboard.ejs           # Protected dashboard
├── public/
│   ├── css/styles.css          # Potluck design system and styles
│   └── js/
│       ├── main.js             # Client-side JavaScript
│       ├── nav.js              # Mobile hamburger nav toggle (REW-50)
│       ├── likes.js            # Favorite/like button optimistic UI (REW-21; also drives My Recipes cards, REW-55)
│       ├── recipe-form.js      # Recipe form handling
│       └── tags-input.js       # Tag input with autocomplete
├── database/
│   └── migrations/             # SQL migration files
├── server.js                   # Entry point
└── package.json
```

## Features

### Recipe Management
- Create, view, edit, and delete recipes
- Rich recipe metadata (prep time, cook time, servings, difficulty)
- Image upload with automatic thumbnail generation
- Draft/Published status workflow
- **Author Defaults to Account Name (REW-46)**: When creating a recipe manually or via import, the Author field is pre-filled with the logged-in user's account display name (their registered name, or email if no name is set) and this default is enforced server-side even if the field is submitted blank. Author remains fully editable, so a recipe can still be attributed to someone else (e.g. "Grandma's recipe").
- **Required Prep Time / Total Time (REW-52)**: The manual "New Recipe" and "Edit Recipe" forms now require both Prep Time and Total Time before a recipe can be saved (draft or published), with inline validation that highlights the missing field(s) and clears as soon as a value is entered; enforced server-side too. "Total Time" is a display-only relabel of the existing Cook Time field — no new database column was added. The Import Recipe flow is unaffected and can still save with blank times.

### Favorites / Recipe Likes (REW-21, REW-55)
- **Heart-Toggle Favoriting**: Authenticated users can like/unlike any **published** recipe from a heart-shaped `.like-btn` control with optimistic UI (instant toggle, reverts on a failed request) and an "Undo" toast after unliking (`public/js/likes.js`, backed by `POST`/`DELETE /api/likes/:recipeId`).
- **Liked Recipes Page**: A dedicated `/recipes/liked` page lists everything the logged-in user has favorited.
- **Favorite Action on My Recipes (REW-55)**: The heart control now also appears directly on each recipe card under **My Recipes** (`/recipes`), not just the single-recipe view — so a user can favorite/unfavorite without opening the recipe. **Draft** recipe cards show the same heart in a disabled/muted state (not clickable) because the underlying `/api/likes/:recipeId` endpoint only allows liking `published` recipes; publishing the recipe enables the control. Favorite state set from My Recipes is immediately reflected on the recipe's detail page and on `/recipes/liked`, since all three surfaces read/write the same `recipe_likes` table.

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

### Potluck Brand Theme (REW-48)
- **Dark Olive Hero**: Hero section with `#4f5c3f` background and botanical decorations
- **Warm Backgrounds**: Oat milk/vanilla (`#faf5ea`) page backgrounds
- **Wavy Dividers**: SVG wave transitions between sections
- **Feature Cards**: Colored left borders with circular icons (Sage, Mist, Blush)
- **CSS Custom Properties**: Complete design token system for maintainability
- **Responsive Design**: Mobile-first with graceful degradation
- **Accessible Outline Buttons (REW-51)**: `.btn-outline` (View, Edit, Import Recipe, Cancel, Clear Filters, and 12 other buttons/links) now renders ink-on-light text (~12.9:1 contrast, ~8.6:1 on hover) instead of the near-invisible cream-on-cream text it previously inherited from a dark-background treatment. The one legitimate dark-background usage (navbar Logout) uses the dedicated `.btn-outline-light` class instead.
- **Single Home Page Search Bar (REW-53)**: The Home page hero no longer renders its own duplicate recipe search form. The header/navigation search bar (`.search-form-nav`, always visible in the navbar) is now the only search entry point on the Home page; the "Welcome to Potluck" heading, lede text, and Browse Recipes/Get Started/Add a Recipe buttons are unchanged.

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

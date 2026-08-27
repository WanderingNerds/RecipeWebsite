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
   - **Redirect URLs**: Add your callback URL(s):
     - Production: `https://your-domain.com/auth/callback`
     - Development: `http://localhost:3000/auth/callback`
4. Authentication is handled automatically by Supabase Auth

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
│   │   └── tagRoutes.js        # Tag API routes
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

### Instant Recipe Scaling (REW-11)
- **Real-time Scaling**: Adjust recipe servings without page reloads
- **Interactive Controls**: Plus/minus buttons for incremental adjustments
- **Direct Input**: Type a specific number of servings
- **Quick Scale Buttons**: One-click multipliers (0.5x, 1x, 2x, 3x) for recipes without parseable servings
- **Professional Accuracy**: Ingredients converted to grams for precise scaling
- **Practical Measurements**: Displays user-friendly amounts (e.g., "1 cup + 2 tbsp")
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

### Potluck Brand Theme (REW-48)
- **Dark Olive Hero**: Hero section with `#4f5c3f` background and botanical decorations
- **Warm Backgrounds**: Oat milk/vanilla (`#faf5ea`) page backgrounds
- **Wavy Dividers**: SVG wave transitions between sections
- **Feature Cards**: Colored left borders with circular icons (Sage, Mist, Blush)
- **CSS Custom Properties**: Complete design token system for maintainability
- **Responsive Design**: Mobile-first with graceful degradation

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

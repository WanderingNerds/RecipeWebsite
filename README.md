# Recipe Website

A recipe website built with Node.js, Express, and Supabase Auth.

## Tech Stack

- **Backend**: Node.js + Express.js (ES modules)
- **Authentication**: Supabase Auth
- **Database**: Supabase (PostgreSQL)
- **Frontend**: EJS server-side rendering

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
   ```

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
3. Authentication is handled automatically by Supabase Auth

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
│   ├── css/styles.css          # Styles
│   └── js/
│       ├── main.js             # Client-side JavaScript
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

## Scripts

- `npm start` - Start production server
- `npm run dev` - Start development server with hot reload

## Security

- Passwords handled securely by Supabase Auth
- HTTP-only secure cookies
- Helmet.js for security headers
- CORS configuration

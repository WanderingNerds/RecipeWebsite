# Implementation Plan: REW-21 Recipe Likes

**Jira Issue:** [REW-21](https://wanderingnerds.atlassian.net/browse/REW-21)
**Status:** Planning Complete
**Created:** 2026-08-16

---

## Summary

Implement a "Like" feature allowing authenticated users to like/unlike recipes. Users can see which recipes they have liked, view like counts on recipes, and access a dedicated "Liked Recipes" page. The feature uses optimistic UI updates with undo capability following Potluck brand guidelines.

---

## Open Questions / Assumptions

| Question | Assumption |
|----------|------------|
| Should users be able to like their own recipes? | **Yes** - no restriction on self-likes |
| Should like counts be visible to everyone? | **Yes** - like counts are public, individual likes are private |
| Where should "Liked Recipes" link appear? | **Navbar** for logged-in users and **Dashboard** |
| Should public recipe views show like button? | **Yes** - with login prompt for unauthenticated users |

---

## Tasks

1. **Create database migration** for `recipe_likes` junction table with RLS policies
2. **Create likes API routes** for like/unlike actions (POST endpoints returning JSON)
3. **Update recipe routes** to include like counts and user's like status
4. **Update recipe views** to display like button and count (view.ejs, public-view.ejs, recipe-card.ejs)
5. **Create Liked Recipes page** with route and view
6. **Add client-side JavaScript** for optimistic like/unlike with undo toast
7. **Add CSS styles** for like button (terracotta accent, heart icon)
8. **Update navbar** to include "Liked" link for authenticated users
9. **Write tests** for likes API endpoints

---

## Affected Files

### New Files

| File | Purpose |
|------|---------|
| `database/migrations/008_create_recipe_likes_table.sql` | Create likes table with indexes and RLS |
| `src/routes/likeRoutes.js` | API endpoints for like/unlike actions |
| `views/recipes/liked.ejs` | Liked recipes list page |
| `public/js/likes.js` | Client-side like interaction with optimistic UI |

### Modified Files

| File | Changes |
|------|---------|
| `src/routes/index.js` | Register like routes, add liked recipes page route |
| `src/routes/recipeRoutes.js` | Include like count and user's like status in recipe fetching |
| `src/routes/publicRoutes.js` | Include like count in public recipe views |
| `views/recipes/view.ejs` | Add like button with count |
| `views/recipes/public-view.ejs` | Add like button (with login prompt for guests) |
| `views/partials/recipe-card.ejs` | Add like count display |
| `views/partials/navbar.ejs` | Add "Liked" link for authenticated users |
| `views/layouts/main.ejs` | Include likes.js script |
| `public/css/styles.css` | Add like button styles |

---

## Database Changes

### Migration: `008_create_recipe_likes_table.sql`

**Table Structure:**
- `user_id` (UUID, FK to auth.users, part of composite PK)
- `recipe_id` (UUID, FK to recipes, part of composite PK)
- `created_at` (TIMESTAMPTZ, for sorting liked recipes by recency)

**Indexes:**
- Composite primary key on (user_id, recipe_id) - prevents duplicate likes
- Index on recipe_id for fast like count queries
- Index on user_id for fetching user's liked recipes

**RLS Policies:**
- SELECT: Users can view their own likes only
- INSERT: Users can insert their own likes
- DELETE: Users can delete their own likes
- No UPDATE policy needed (likes are binary - insert/delete only)

**Helper Function:**
- Create a `get_recipe_like_count(recipe_id)` function for efficient count retrieval
- Consider a `likes_count` column on recipes table with trigger for denormalized count (optional optimization)

---

## API Endpoints

### Like Routes (`src/routes/likeRoutes.js`)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/likes/:recipeId` | Required | Like a recipe |
| DELETE | `/api/likes/:recipeId` | Required | Unlike a recipe |
| GET | `/api/likes/:recipeId` | Optional | Get like status and count for a recipe |

**Response Format:**
```json
{
  "liked": true,
  "count": 42,
  "recipeId": "uuid-here"
}
```

### Liked Recipes Page

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/recipes/liked` | Required | Display user's liked recipes |

---

## Frontend Implementation

### Like Button Component

**Location:** Rendered inline in recipe views

**States:**
1. **Not liked** - Outlined heart, count displayed
2. **Liked** - Filled terracotta heart, count displayed
3. **Loading** - Subtle pulse animation during API call
4. **Disabled** - For guests on public view (shows login prompt on click)

**HTML Structure:**
```html
<button class="like-btn" data-recipe-id="<%= recipe.id %>" data-liked="<%= isLiked %>">
  <span class="like-btn-icon">&#9829;</span>
  <span class="like-btn-count"><%= likeCount %></span>
</button>
```

### Optimistic UI Pattern

Following Potluck brand guidelines:

1. User clicks like button
2. Immediately update UI (toggle heart, increment/decrement count)
3. Send API request in background
4. If API fails, revert UI and show error toast
5. On successful unlike, show "Undo" toast for 5 seconds
6. Clicking "Undo" re-likes the recipe

### Toast Notification

**Undo Toast:**
```html
<div class="toast toast-undo">
  Recipe unliked. <button class="toast-undo-btn">Undo</button>
</div>
```

---

## CSS Styles

Add to `public/css/styles.css`:

```css
/* Like Button */
.like-btn {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  padding: var(--space-2) var(--space-3);
  background: transparent;
  border: 1px solid var(--color-divider);
  border-radius: var(--radius-pill);
  cursor: pointer;
  transition: all 0.15s ease;
}

.like-btn:hover {
  border-color: var(--color-accent);
}

.like-btn[data-liked="true"] {
  background: var(--color-accent-100);
  border-color: var(--color-accent);
}

.like-btn-icon {
  font-size: 18px;
  color: var(--color-neutral-500);
  transition: color 0.15s ease, transform 0.15s ease;
}

.like-btn[data-liked="true"] .like-btn-icon {
  color: var(--color-accent);
}

.like-btn:active .like-btn-icon {
  transform: scale(1.2);
}

.like-btn-count {
  font-size: 14px;
  font-weight: 600;
  color: var(--color-neutral-700);
}

/* Toast */
.toast {
  position: fixed;
  bottom: var(--space-6);
  left: 50%;
  transform: translateX(-50%);
  padding: var(--space-3) var(--space-4);
  background: var(--color-neutral-800);
  color: var(--color-bg);
  border-radius: var(--radius-pill);
  box-shadow: var(--shadow-lg);
  z-index: 1000;
  animation: toast-in 0.3s ease;
}

.toast-undo-btn {
  background: transparent;
  border: none;
  color: var(--color-accent-300);
  font-weight: 600;
  cursor: pointer;
  margin-left: var(--space-2);
}

@keyframes toast-in {
  from { opacity: 0; transform: translateX(-50%) translateY(20px); }
  to { opacity: 1; transform: translateX(-50%) translateY(0); }
}
```

---

## Security Considerations

| Concern | Mitigation |
|---------|------------|
| Like spamming | Rate limit like/unlike to 30 actions per minute per user |
| CSRF on like actions | Include CSRF token in API requests (use existing pattern) |
| Unauthorized access | RLS policies ensure users can only manage their own likes |
| Like count manipulation | Like counts derived from table, not user input |
| Recipe existence validation | Verify recipe exists before allowing like |

---

## Acceptance Criteria

- [ ] Authenticated user can like a recipe by clicking the heart button
- [ ] Authenticated user can unlike a recipe by clicking the filled heart button
- [ ] Like button shows filled terracotta heart when recipe is liked
- [ ] Like count is displayed next to the heart and updates on like/unlike
- [ ] UI updates optimistically (immediately) before API response
- [ ] Failed API calls revert the UI and show error message
- [ ] Unlike action shows "Undo" toast for 5 seconds
- [ ] Clicking "Undo" re-likes the recipe
- [ ] "Liked Recipes" page shows all recipes user has liked
- [ ] "Liked" link appears in navbar for authenticated users
- [ ] Unauthenticated users see like count but clicking shows login prompt
- [ ] Users cannot like the same recipe twice (database constraint)
- [ ] Like actions are rate limited to prevent abuse

---

## Test Cases

### Unit Tests

**File:** `src/routes/likeRoutes.test.js`

1. POST /api/likes/:recipeId - successfully like a recipe
2. POST /api/likes/:recipeId - liking already-liked recipe returns current state
3. DELETE /api/likes/:recipeId - successfully unlike a recipe
4. DELETE /api/likes/:recipeId - unliking not-liked recipe returns current state
5. GET /api/likes/:recipeId - returns correct count and liked status
6. POST /api/likes/:recipeId - returns 401 for unauthenticated user
7. POST /api/likes/:invalidId - returns 404 for non-existent recipe

### Integration Tests

1. Like recipe -> verify count increments -> check liked recipes page shows it
2. Unlike recipe -> verify count decrements -> check removed from liked recipes page
3. Multiple users like same recipe -> verify count reflects all likes
4. Rate limit exceeded -> verify 429 response

---

## Implementation Notes

### Fetching Like Status Efficiently

When loading recipe views, batch-fetch like status to avoid N+1 queries:

```javascript
// In route handler
const likedRecipeIds = await supabaseClient
  .from("recipe_likes")
  .select("recipe_id")
  .eq("user_id", req.user.id)
  .in("recipe_id", recipeIds);

// Create a Set for O(1) lookup
const likedSet = new Set(likedRecipeIds.data?.map(r => r.recipe_id));
```

### Like Count Options

**Option A: Query-time count (simpler, recommended for MVP)**
- Count likes on each recipe view
- Use index on recipe_id for performance

**Option B: Denormalized count (future optimization)**
- Add `likes_count` column to recipes table
- Update via database trigger on insert/delete to recipe_likes
- Better for high-traffic recipes

Recommend Option A for initial implementation, with Option B as future optimization if needed.

---

## Out of Scope (Future Enhancements)

- Social features (see who liked a recipe)
- Notifications when your recipe is liked
- "Popular" or "Trending" recipes based on likes
- Recipe recommendations based on likes
- Like animation (animated heart burst)

---

## Ready for Development

This plan is ready for handoff to the Developer agent. The implementation follows existing patterns in the codebase and addresses all aspects of the Recipe Likes feature.

**Reference Files:**
- `database/migrations/005_create_recipe_categories_table.sql` - Junction table pattern
- `src/routes/recipeRoutes.js` - Route patterns and Supabase client usage
- `public/js/main.js` - Client-side AJAX pattern
- `views/recipes/view.ejs` - Where to add like button
- `public/css/styles.css` - Styling patterns and design tokens

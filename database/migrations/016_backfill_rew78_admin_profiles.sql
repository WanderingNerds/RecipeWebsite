-- REW-78: provision the two fixed feedback assignees from existing Auth users.
-- The email match is deliberately exact after case normalization; no partial
-- matching or general synchronization from auth.users is performed.
INSERT INTO public.admin_profiles (id, display_name, active)
SELECT
  users.id,
  CASE lower(users.email)
    WHEN 'carroll.andrew@gmail.com' THEN 'Andrew'
    WHEN 'vhobbs1895@gmail.com' THEN 'Victoria'
  END,
  TRUE
FROM auth.users AS users
WHERE lower(users.email) IN (
  'carroll.andrew@gmail.com',
  'vhobbs1895@gmail.com'
)
AND users.raw_app_meta_data ->> 'role' = 'admin'
ON CONFLICT (id) DO UPDATE
SET
  display_name = EXCLUDED.display_name,
  active = TRUE;

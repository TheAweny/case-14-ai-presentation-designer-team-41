-- 003 seeded admin@example.com with a well-known password, which every installation of a public
-- repository would share. Accounts now come from AUTH_USERS, written by `lct onboard` and
-- `lct user`, and the API loads them at start. The seeded account goes, but only while it still
-- has the password everyone knows: an account someone has already secured stays.
DELETE FROM app_users
WHERE email = 'admin@example.com'
  AND password_hash = crypt('123123', password_hash);

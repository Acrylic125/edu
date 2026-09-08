UPDATE user
SET email_verified = 1,
    updated_at = CAST(unixepoch('subsec') * 1000 AS INTEGER)
WHERE email_verified = 0
  AND EXISTS (
    SELECT 1
    FROM account
    WHERE account.user_id = user.id
      AND account.provider_id IN ('google', 'microsoft')
  );

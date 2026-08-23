alter table public.webhook_subscriptions
  add column if not exists last_notification_at timestamptz;

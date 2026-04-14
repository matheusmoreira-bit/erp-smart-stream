---
name: Notification Center
description: In-app notification bell with realtime updates, notification preferences per category (in_app + email), helper to create notifications
type: feature
---

## Tables
- notifications: user_identifier, company_db, title, body, category, is_read, link, metadata
- notification_preferences: user_identifier, category, in_app (bool), email (bool) — unique per user+category

## Categories
approval, expense, integration, system, credential

## Components
- NotificationBell: popover in header with unread badge, shows latest 10
- Notifications page (/notifications): full list + preferences tab

## Creating Notifications
Use `createNotification()` from `src/lib/notifications.ts` — silent, never blocks main flow.

## Realtime
notifications table has realtime enabled; useNotifications subscribes to INSERT events filtered by user_identifier.

## Permissions
- notifications module key added to ALL_MODULES
- Bell is always visible in header (not gated by permissions)

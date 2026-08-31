<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# DLXSTORE Try-On Feature Status

## Current State: NOT IMPLEMENTED

The Try-On virtual try-on feature is **not implemented** despite having database schema prepared.

### What Exists
- Database table: `try_on_jobs` (migration: `20260829060000_customer_avatar_reconciliation.sql`)
- Schema includes: profile_id, product_id, avatar_id, status, provider, result_image_url, error
- RLS policies for customers and admins
- Avatar system is fully functional

### What's Missing
- No UI components for Try-On (no product page integration, no Try-On button)
- No service layer for creating/managing try-on jobs
- No integration with external AI services for virtual try-on generation
- No try-on history or results display

### External Dependency Required
Virtual try-on generation requires an external AI service/API that can:
- Take customer avatar attributes and product images
- Generate realistic virtual try-on result images
- Return processed images via API

This is a **future feature** requiring integration with a third-party AI service (e.g., virtual try-on APIs). Do not implement Try-On functionality without:
1. Identifying a specific AI service provider
2. Configuring API credentials
3. Building the service integration layer
4. Creating the UI flow

### Avatar System
The customer Avatar system is **fully implemented and functional**:
- AvatarEditor with 8 customizable attributes
- Live preview with emoji/swatch representation
- Persistent Supabase storage
- AvatarBadge display in header and identity contexts
- Full i18n support across 6 languages
- Dashboard integration

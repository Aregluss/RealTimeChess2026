# Social Preview Assets

Use these two images for iMessage/social link previews.

## Image files
- `site-default` (homepage / general site link preview)
  - Fallback file in repo: `apps/web/public/og/site-default.svg`
  - Recommended final upload format: PNG or JPG
  - Recommended size: `1200x630`
- `invite-default` (game invite link preview)
  - Fallback file in repo: `apps/web/public/og/invite-default.svg`
  - Recommended final upload format: PNG or JPG
  - Recommended size: `1200x630`

## Env vars (Blob-first)
- `NEXT_PUBLIC_OG_SITE_IMAGE_URL`
  - Absolute public URL to site preview image (Blob or CDN).
- `NEXT_PUBLIC_OG_INVITE_IMAGE_URL`
  - Absolute public URL to invite preview image (Blob or CDN).

If env vars are unset, app falls back to the static files above.

## Cache busting
When replacing a Blob image, append `?v=<new-number>` to force refresh in social scrapers/iMessage.

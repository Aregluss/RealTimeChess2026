export function getSiteUrl(): URL {
  const raw =
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim() ||
    process.env.VERCEL_URL?.trim() ||
    'http://localhost:3000';

  const normalized =
    raw.startsWith('http://') || raw.startsWith('https://') ? raw : `https://${raw}`;

  try {
    return new URL(normalized);
  } catch {
    return new URL('http://localhost:3000');
  }
}

function normalizeImageUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    return trimmed;
  }

  if (
    trimmed.startsWith('http://') ||
    trimmed.startsWith('https://') ||
    trimmed.startsWith('/')
  ) {
    return trimmed;
  }

  return `https://${trimmed}`;
}

export function getSocialImageUrl(kind: 'site' | 'invite'): string {
  const siteImageFromEnv = process.env.NEXT_PUBLIC_OG_SITE_IMAGE_URL?.trim();
  const inviteImageFromEnv = process.env.NEXT_PUBLIC_OG_INVITE_IMAGE_URL?.trim();

  if (kind === 'site' && siteImageFromEnv) {
    return normalizeImageUrl(siteImageFromEnv);
  }

  if (kind === 'invite' && inviteImageFromEnv) {
    return normalizeImageUrl(inviteImageFromEnv);
  }

  if (kind === 'site') {
    return '/og/site-default.svg';
  }

  return '/og/invite-default.svg';
}

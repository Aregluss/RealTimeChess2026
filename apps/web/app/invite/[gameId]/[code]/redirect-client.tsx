'use client';

import { useEffect } from 'react';

type InviteRedirectClientProps = {
  href: string;
};

export default function InviteRedirectClient({ href }: InviteRedirectClientProps) {
  useEffect(() => {
    window.location.replace(href);
  }, [href]);

  return null;
}

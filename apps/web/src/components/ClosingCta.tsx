'use client';

import React from 'react';
import Link from 'next/link';

export function ClosingCta() {
  return (
    <section className="cta-band" aria-labelledby="cta-title">
      <div className="cta-band-inner section-wrap">
        <h2 id="cta-title">
          Your assets. Working harder.
        </h2>
        <Link href="/markets" className="cta-band-button">
          Explore markets <span aria-hidden="true">↗</span>
        </Link>
      </div>
    </section>
  );
}

'use client';

import {ComponentAPI, PropTable} from '@/components/PropTable';
import docs from '!doc!@/components/PropTable';
import {TypeContext} from '@faulty/ts-docs-type-renderer/react';

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-between p-24">
      <div>
        <h1 className="text-xl font-bold mb-8">ComponentAPI</h1>
        <ComponentAPI docs={docs} componentName="ComponentAPI" />
      </div>
    </main>
  );
}

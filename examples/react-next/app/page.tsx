'use client';

import {ComponentAPI} from '@/components/PropTable';
import docs from '!doc!@/components/ExampleComponents';

export default function Home() {
  return (
    <main className="p-4">
      <div>
        <h1 className="text-xl font-bold mb-8">ComponentAPI</h1>
        <ComponentAPI docs={docs} componentName="ExampleInput" />
      </div>
    </main>
  );
}

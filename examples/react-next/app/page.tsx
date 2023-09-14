'use client';

import {ComponentAPI} from '@/components/PropTable';
import docs from '!doc!@/components/ExampleComponents';

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-between p-24">
      <div>
        <h1 className="text-xl font-bold mb-8">ComponentAPI</h1>
        <ComponentAPI docs={docs} componentName="ExampleInput" />
      </div>
    </main>
  );
}

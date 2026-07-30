// Ambient declaration so the typechecked routes can import the verbatim
// Rohy affect component (a .jsx copied unchanged). Mirrors the app's existing
// pattern for legacy .js modules (see src/legacy/demoFixture.d.ts).
declare module '@/components/oyon/OyonAffectV2.jsx' {
  import type { ComponentType } from 'react';
  const OyonAffectV2: ComponentType<{ records: unknown[]; loading?: boolean }>;
  export default OyonAffectV2;
}

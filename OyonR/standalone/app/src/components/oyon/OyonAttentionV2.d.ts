// Ambient declaration so the typechecked routes can import the verbatim
// Rohy attention/engagement component (a .jsx copied unchanged).
declare module '@/components/oyon/OyonAttentionV2.jsx' {
  import type { ComponentType } from 'react';
  const OyonAttentionV2: ComponentType<{ records: unknown[]; loading?: boolean }>;
  export default OyonAttentionV2;
}

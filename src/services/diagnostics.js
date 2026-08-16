// Client-side entry point for the radiology / diagnostics modality vocabulary.
// The canonical module lives at server/shared/diagnostics.js because the
// Docker runtime image ships server/ but not src/ — see the comment there.
// Client code imports from HERE so the bundler owns the cross-tree path in
// exactly one place (mirrors src/services/rhythms.js).
export * from '../../server/shared/diagnostics.js';

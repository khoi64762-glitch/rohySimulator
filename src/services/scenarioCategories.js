// Client-side entry point for the scenario category vocabulary.
// The canonical module lives at server/shared/scenarioCategories.js because
// the Docker runtime image ships server/ but not src/ — see the comment there.
// Client code imports from HERE so the bundler owns the cross-tree path in
// exactly one place (mirrors src/services/rhythms.js).
export * from '../../server/shared/scenarioCategories.js';

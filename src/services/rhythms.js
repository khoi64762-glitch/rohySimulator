// Client-side entry point for the ECG rhythm vocabulary.
// The canonical module lives at server/shared/rhythms.js because the Docker
// runtime image ships server/ but not src/ — see the comment there.
// Client code imports from HERE so the bundler owns the cross-tree path in
// exactly one place (mirrors src/services/patientDemographics.js).
export * from '../../server/shared/rhythms.js';

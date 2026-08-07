// Client-side entry point for the patient-demographic vocabularies.
// The canonical module lives at server/shared/patientDemographics.js because
// the Docker runtime image ships server/ but not src/ — see the comment there.
// Client code imports from HERE so the bundler owns the cross-tree path in
// exactly one place (mirrors src/i18n/languages.js).
export * from '../../server/shared/patientDemographics.js';
